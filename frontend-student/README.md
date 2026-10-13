# 学生/家长 H5（frontend-student）

培训学校多校区收费系统的学生端：手机网页（微信内置浏览器优先），家长凭学校发放的一次性登录码验证身份、查看账单并用微信 JSAPI 支付。

技术栈：Vue 3 + TypeScript + Vite + Vant 4 + Pinia + Axios，对应 PRD §6.1/§6.2。

## 页面

| 路由 | 页面 | PRD 对应 |
|---|---|---|
| `/login` | A 登录码验证（支持粘贴、限流友好错误、不透露学生是否存在） | §6.2 页面 A |
| `/` | B 首页（脱敏姓名、开放收费期、待付/已付金额） | §6.2 页面 B |
| `/invoices/:id` | C 账单详情（项目快照、金额、状态；已支付禁用重复支付） | §6.2 页面 C |
| `/pay/:invoiceId` | D 确认支付（服务端建单→JSAPI 调起；防重复点击；非微信环境明确引导） | §6.2 页面 D |
| `/pay/result/:orderId` | E 支付结果（轮询服务端订单状态，不以 JSAPI 回调为准） | §6.2 页面 E |
| `/history` | 历史缴费查询 + 退款记录 | §9.1 |

## 启动 / 构建

```bash
cp .env.example .env        # 按需修改 VITE_API_BASE_URL
npm install
npm run dev                 # 开发
npm run build               # 构建（TypeScript strict，必须通过）
npm run preview             # 预览构建产物
```

## 与后端联调说明（PRD §9 契约）

- API 前缀 `/api/v1`；`VITE_API_BASE_URL` 未配置时默认走同域 `/api/v1`。
- **认证**：学生端会话优先走 Cookie（axios `withCredentials: true`）。刷新页面后路由守卫用 `GET /me/students` 恢复会话；401 全局跳转 `/login`。
  同时兼容 Bearer token（`localStorage.tfs_auth_token`），后端二选一即可。
- **登录码**：`POST /auth/code/exchange` →（可选二次确认）→ `POST /auth/bind`。登录码只在请求体中传递，绝不出现在 URL；失败提示统一为“登录码无效或已过期”，不透露学生是否存在。
- **支付**：`POST /me/payments`（带 `X-Idempotency-Key` 幂等键）返回订单 + JSAPI 参数，前端 `WeixinJSBridge.invoke('getBrandWCPayRequest', …)` 调起。
  无论 JSAPI 回调成功/取消/失败/超时，结果页都轮询 `GET /me/payments/{id}` 直到终态（paid/failed/closed），最长约 2 分钟。
- **金额**：后端一律用“分”（整数）；前端统一 `fenToYuan` 显示两位小数。
- **时间**：后端存 UTC；前端按 Asia/Shanghai 展示。
- **Mock 联调**：后端提供 Mock 支付适配器时，前端无需改动——JSAPI 参数照常透传；非微信环境（桌面浏览器）会显示“请在微信中打开”引导，便于联调时识别。

## 安全注意

- 前端绝不存储支付密钥；不记录、不回显登录码明文（签发仅后端可见）。
- 错误提示经统一归一化，不泄露 SQL/堆栈/密钥等内部信息。
