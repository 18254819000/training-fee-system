import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// 当前管理员（AdminJwtGuard 注入）
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});

// 当前学生会话（StudentSessionGuard 注入）
export const CurrentStudentSession = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().studentSession;
});

// 请求追踪 ID
export const RequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().requestId;
});

// 客户端 IP（审计用，已做脱敏处理见 AuditService）
export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.ip || '';
  return ip;
});
