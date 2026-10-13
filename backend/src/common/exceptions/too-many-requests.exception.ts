import { HttpException, HttpStatus } from '@nestjs/common';

// 429 限流异常（@nestjs/common 未内置，项目本地定义）
// 响应体保持统一错误形状 {code,message,requestId}（由 http-exception.filter 兜底）
export class TooManyRequestsException extends HttpException {
  constructor(response?: string | Record<string, any>) {
    super(response ?? { code: 'ERR_RATE_LIMITED', message: '请求过于频繁，请稍后再试' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
