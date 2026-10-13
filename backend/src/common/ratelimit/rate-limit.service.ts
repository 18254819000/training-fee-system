import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

// 限流服务：固定窗口计数。key 形如 ratelimit:login-code:1.2.3.4
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** 命中一次计数；超限返回 false */
  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const fullKey = `ratelimit:${key}`;
    const count = await this.redis.incr(fullKey);
    if (count === 1) {
      await this.redis.expire(fullKey, windowSeconds);
    }
    return count <= limit;
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`ratelimit:${key}`);
  }
}
