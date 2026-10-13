import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// BigInt 序列化拦截器：Prisma 的 BIGINT（分单位金额）返回 JS bigint，
// JSON.stringify 无法序列化 bigint，此处全局转换为 Number。
// 金额上限远小于 Number.MAX_SAFE_INTEGER，转 Number 安全。
@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => this.convert(data)));
  }

  private convert(value: unknown): unknown {
    if (typeof value === 'bigint') return Number(value);
    if (Array.isArray(value)) return value.map((v) => this.convert(v));
    if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.convert(v);
      }
      return out;
    }
    return value;
  }
}
