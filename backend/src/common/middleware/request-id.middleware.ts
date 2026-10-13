import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import * as crypto from 'crypto';

// 请求追踪 ID：透传上游 x-request-id，否则生成；全链路日志/审计/错误都带上
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    const requestId =
      (Array.isArray(incoming) ? incoming[0] : incoming) || crypto.randomBytes(16).toString('hex');
    (req as any).requestId = requestId;
    next();
  }
}
