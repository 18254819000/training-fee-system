# 培训学校收费系统 · 后端 API（一期 MVP）

NestJS + TypeScript + Prisma + MySQL 8 + Redis。账单模式：后台生成账单 → 家长在微信 H5 确认 → 微信 JSAPI 支付。

## 快速开始

```bash
# 1. 准备环境变量
cp .env.example .env

# 2. 一键启动（MySQL + Redis + 后端）
docker compose up -d

# 3. 写入种子数据（角色/超管/校区/收费期/课程价格/学员+登录码/Mock 支付账户/示例账单）
docker compose exec backend npx tsx prisma/seed.ts
# 登录码明文仅在控制台输出一次
```

本地开发（不使用 Docker）：

```bash
npm install
npx prisma migrate dev
npx tsx prisma/seed.ts
npm run start:dev
```

Swagger：`http://localhost:3000/api-docs`

## 前后端契约说明

### 参数命名

- **入参**：前端传 `camelCase`（如 `campusId`），全局 `CaseMiddleware` 自动转为 `snake_case`；
  后端 DTO 一律使用 `snake_case`。`pageSize` 保持原样。
- **出参**：全局 `TransformInterceptor` 将 `snake_case` 转回 `camelCase`，并把 `BigInt` 转为 `Number`
  （金额为分，前端展示时除以 100）。

### 认证

- 管理端：`POST /admin/auth/login` → Bearer JWT（8h）；登出 `POST /admin/auth/logout`。
- 学生端：一次性登录码 → `POST /auth/code/exchange` 拿 `exchangeToken` →
  `POST /auth/bind` 下发 HttpOnly Cookie `tfs_session`（72h）。后续 `/me/*` 接口走 Cookie。

### 统一错误

`{ code, message, requestId }`，HTTP 状态码语义：400 参数/状态错误、401 未认证、
403 无权限、404 不存在、409 重复提交、429 限流。

### 权限码（后端权威，共 23 个，前端以此对齐）

```
campus:read / campus:write
fee-period:read / fee-period:write
student:read / student:write / student:import
login-code:manage
fee-item:read / fee-item:write
invoice:read / invoice:generate / invoice:void
payment:read / payment:reconcile
refund:apply / refund:submit
report:read / export
payment-account:read / payment-account:manage
admin-user:manage
audit:read
```

`super_admin` 拥有 `*`。内置角色权限见 `prisma/seed.ts`。

## 核心铁律实现位置

| 铁律 | 实现 |
|---|---|
| 服务端算价 | `wechat-pay.service.ts` createOrder（按账单应收−已付） |
| 通知幂等 | `payment_notifications` 唯一键 + `applyPaidEvent` 去重 |
| out_trade_no / wechat_transaction_id 唯一 | Prisma schema 唯一约束 |
| 账单批量生成防重 | 幂等键 + `@@unique([student_id, fee_period_id])` 跳过 |
| 退款仅全额 + 防重 | `refund.service.ts` apply（金额校验 + 进行中退款单 409） |
| 校区行级校验 | `CampusScopeService.assertCampus`，各 service 调用 |
| 密钥只存引用 | `payment-account` 存 `enc:v1:`/`env:` 引用，列表/详情脱敏 |
| 登录码安全 | 128bit 随机、HMAC-SHA256(pepper) 只存哈希、单次使用、过期、失败限流 |

## 微信支付

- `WECHAT_PAY_MODE=mock`（默认）：`MockWechatPayAdapter`，下单返回测试 JSAPI 参数；
  管理端 `POST /admin/payment-orders/{id}/simulate-paid` 模拟支付成功（非生产环境）。
- `WECHAT_PAY_MODE=real`：`RealWechatPayAdapter`（APIv3 签名/验签/AES-GCM 解密已实现），
  需在支付账户中配置真实商户私钥、APIv3 密钥、平台公钥并通过自检后启用。
- 通知：`POST /wechat/notify` / `POST /wechat/refund-notify`（公开端点，走签名验签；
  验签用 Express `rawBody`，main.ts 已开启）。

## 测试

```bash
npm test   # Jest：登录码兑换、账单防重、通知幂等、退款防重
```

## 目录结构

```
src/
  main.ts                 # rawBody、cookie-parser、全局过滤器/拦截器
  app.module.ts
  common/                 # prisma / crypto / redis / 限流 / 幂等 / guards / 中间件
  modules/
    auth/                 # 管理员登录、学生登录码兑换/bind/logout
    login-code/           # 登录码批量签发（明文仅返回一次）
    campus/ fee-period/ course/ student/ invoice/
    wechat-pay/           # 适配器（Mock/真实）+ 下单/通知/查单
    refund/               # 申请（全额防重）/提交/同步
    report/               # 收费统计 + 任务制导出（CSV）
    payment-account/      # 支付账户 CRUD/自检/启用停用（密钥只存引用）
    admin-user/           # 管理员/角色 CRUD + 审计日志查询
    student-portal/       # /me/* 学生端门户
    audit/                # 审计日志写入
```
