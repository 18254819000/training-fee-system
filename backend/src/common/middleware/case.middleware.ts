import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

// 入参命名转换中间件：前端统一使用 camelCase，后端 DTO/Prisma 使用 snake_case，
// 此处将 query 与 JSON body 的键递归转换为 snake_case，DTO 无需改动。
// 例外：pageSize 保持原样（PaginationDto 使用 camelCase）；
// 微信支付通知路径跳过（原始报文参与验签，不碰解析后的 body）。
const KEEP_AS_IS = new Set(['pageSize']);

function toSnakeKey(key: string): string {
  if (KEEP_AS_IS.has(key)) return key;
  return key.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`);
}

function convertKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convertKeys);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[toSnakeKey(k)] = convertKeys(v);
    }
    return out;
  }
  return value;
}

@Injectable()
export class CaseMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    // 微信支付通知路径已在 AppModule.exclude 中排除，此处不再检查 URL
    try {
      const q = (req as any).query;
      if (q && typeof q === 'object') (req as any).query = convertKeys(q);
    } catch {
      /* 忽略 query 转换异常 */
    }
    const body = (req as any).body;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      (req as any).body = convertKeys(body);
    }
    next();
  }
}
