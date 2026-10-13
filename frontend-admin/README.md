# 管理后台 frontend-admin

培训学校多校区收费系统 · 管理后台（Vue 3 + TypeScript + Vite + Element Plus），对应 PRD §6.3 全部 14 个页面。

## 页面清单（PRD §6.3）

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | 管理员登录 | 账号密码,失败提示,失败次数限制由后端执行 |
| `/dashboard` | 数据总览 | 应收/实收/待收/退款 + ECharts 金额统计,日期/校区/收费期筛选 |
| `/campuses` | 校区管理 | 列表/新增/编辑/停用,校区编码唯一 |
| `/fee-periods` | 收费期管理 | 新建/编辑/开放/结束,结束后禁增新账单 |
| `/students` | 学生管理 | 查询/新增/编辑/停用;Excel 导入四步:上传→预览→确认→错误报告下载 |
| `/login-codes` | 登录码管理 | 批量签发/撤销/重新签发/状态查询;明文码仅签发时展示一次用于打印 |
| `/fee-items` | 课程与收费项目 | 项目管理、校区价格设置、调价历史(价格记录不物理删除) |
| `/invoices` | 账单管理 | 生成预览/批量生成(防重)/查询/按权限作废 |
| `/payment-orders` | 支付订单 | 查询/详情/服务端查单/通知处理状态 |
| `/refunds` | 退款管理 | 申请/审批/执行/状态追踪;一期仅全额退款 |
| `/reports` | 财务报表 | 汇总/明细/筛选/受控导出(任务制) |
| `/payment-accounts` | 微信支付配置 | PRD §5.2 表单校验、配置检查、测试/正式分离、启用二次确认 |
| `/users` | 管理员与角色 | 账号/角色/校区授权、停用/启用、重置密码 |
| `/audit-logs` | 审计日志 | 只读;操作者/操作/资源/结果/请求追踪 ID |

## 全局约定（PRD §6.4）

- 金额统一按"分"传输、两位小数展示(`utils/format.ts: fenToYuan`)
- 时间按 `Asia/Shanghai` 展示,后端统一存 UTC
- 姓名/手机号脱敏展示(`maskName`/`maskPhone`)
- 提交按钮 loading 防重复提交;空/加载/错误/无权限状态齐全
- 错误提示不泄露 SQL/密钥/堆栈等内部信息
- **前端绝不存储、传输、展示支付密钥明文**;登录码不在 URL 中传递

## API 契约（PRD §9.2）

统一前缀 `/api/v1`,见 `src/api/admin.ts`。客户端兼容 `{code,data,message}` 与裸数据两种返回;分页兼容 `PageResult` 与裸数组。

### 与 PRD §9 的契约疑问（待后端确认）

1. `PATCH /admin/fee-items/{id}`、`PATCH /admin/users/{id}`：PRD §9.2 未列出,前端已按惯例调用;若后端未实现会返回 404,届时改为禁用编辑或补后端接口。
2. `POST /admin/login-codes/batch` 返回的明文码字段：前端期望 `codes: [{studentId, studentName, code, expiresAt}]`,与后端 `LoginCodeBatchResult` 对齐即可。
3. 导出为任务制：前端 `POST /admin/reports/exports` 拿到 `taskId` 后当前仅提示"导出任务已创建";若后端支持轮询/下载链接,需要补充下载逻辑。
4. 角色权限字符串：前端使用 `campus:manage` 等 17 个权限码(见 `Users.vue: ALL_PERMISSIONS`),需与后端 RBAC 权限码保持一致。

## 本地开发

```bash
npm install
cp .env.example .env   # 按需修改 VITE_API_BASE_URL
npm run dev            # http://localhost:5173
npm run build          # vue-tsc -b && vite build,产物在 dist/
npm run preview
```

后端联调：先启动后端（见 `../backend/README.md` docker-compose）,再将 `.env` 中的
`VITE_API_BASE_URL` 指向后端地址；亦可在后端网关做同域 `/api/v1` 反向代理,此时可留空该变量。
