import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

// 统一错误格式：{ code, message, requestId, details? }
// 铁律：错误消息不得泄露 SQL、密钥、内部堆栈、学生是否存在等敏感信息
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = (req as any).requestId || 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'ERR_INTERNAL';
    let message = '服务器内部错误，请稍后重试';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body: any = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        code = body.code || `ERR_${status}`;
        // 4xx 允许返回业务 message；5xx 一律脱敏
        message = status >= 500 ? '服务器内部错误，请稍后重试' : body.message || exception.message;
        if (status < 500 && body.details) details = body.details;
      } else {
        message = status >= 500 ? message : String(body);
      }
    } else {
      // 非 HttpException：记录完整堆栈（日志），对外脱敏
      this.logger.error(`[${requestId}] 未捕获异常 ${req.method} ${req.url}`, (exception as Error)?.stack);
    }

    if (status >= 500) {
      this.logger.error(`[${requestId}] ${req.method} ${req.url} -> ${status}`, (exception as Error)?.stack);
    }

    res.setHeader('x-request-id', requestId);
    res.status(status).json({ code, message, requestId, ...(details ? { details } : {}) });
  }
}
