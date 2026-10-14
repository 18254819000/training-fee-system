import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// 幂等服务：防重复提交（下单/退款/批量账单）
// 原理：scope + key 唯一约束；首次执行占位，成功后回填响应；重复 key 直接返回首次结果
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T>(scope: string, key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    try {
      await this.prisma.idempotencyKey.create({
        data: { key, scope, expires_at: expiresAt },
      });
    } catch (e: any) {
      // 唯一冲突 → 可能是重复提交
      if (e?.code === 'P2002') {
        const existing = await this.prisma.idempotencyKey.findUnique({ where: { key } });
        if (existing && existing.scope === scope && existing.expires_at > now && existing.response_json != null) {
          return { result: existing.response_json as T, replayed: true };
        }
        // 占位但尚未完成（并发中）→ 拒绝，避免并发双写
        throw new ConflictException({ code: 'ERR_IDEMPOTENT_CONFLICT', message: '请求正在处理中，请稍后查询结果' });
      }
      throw e;
    }

    try {
      const result = await fn();
      // BigInt（如 Prisma 的 amount_fen）无法被 JSON.stringify 序列化，先转 Number
      const safeJson = JSON.parse(JSON.stringify(result ?? null, (_, v) =>
        typeof v === 'bigint' ? Number(v) : v,
      )) as any;
      await this.prisma.idempotencyKey.update({
        where: { key },
        data: { response_json: safeJson },
      });
      return { result: safeJson, replayed: false };
    } catch (err) {
      // 执行失败则删除占位，允许重试
      await this.prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
      throw err;
    }
  }
}
