import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

// Redis 服务：未配置 REDIS_URL 或连接失败时自动降级为内存实现，
// 保证开发/测试环境无需 Redis 也能跑（限流语义保持一致）
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private readonly memory = new Map<string, { value: string; expireAt: number }>();
  readonly available: boolean;

  constructor() {
    const url = process.env.REDIS_URL || '';
    if (url) {
      try {
        this.client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
        this.client.on('error', (e) => this.logger.warn(`Redis 连接异常，已降级为内存模式: ${e.message}`));
        this.available = true;
      } catch (e: any) {
        this.logger.warn(`Redis 初始化失败，已降级为内存模式: ${e.message}`);
        this.available = false;
      }
    } else {
      this.logger.warn('未配置 REDIS_URL，限流/缓存使用内存模式（单机）');
      this.available = false;
    }
  }

  private useMemory(): boolean {
    return !this.client;
  }

  private memGet(key: string): string | null {
    const item = this.memory.get(key);
    if (!item) return null;
    if (Date.now() > item.expireAt) {
      this.memory.delete(key);
      return null;
    }
    return item.value;
  }

  async incr(key: string): Promise<number> {
    if (this.useMemory()) {
      const cur = parseInt(this.memGet(key) || '0', 10) + 1;
      const item = this.memory.get(key);
      this.memory.set(key, { value: String(cur), expireAt: item?.expireAt || Date.now() + 60000 });
      return cur;
    }
    return this.client!.incr(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    if (this.useMemory()) {
      const item = this.memory.get(key);
      if (item) item.expireAt = Date.now() + seconds * 1000;
      return;
    }
    await this.client!.expire(key, seconds);
  }

  async get(key: string): Promise<string | null> {
    if (this.useMemory()) return this.memGet(key);
    return this.client!.get(key);
  }

  async set(key: string, value: string, seconds?: number): Promise<void> {
    if (this.useMemory()) {
      this.memory.set(key, { value, expireAt: Date.now() + (seconds || 3600) * 1000 });
      return;
    }
    if (seconds) await this.client!.set(key, value, 'EX', seconds);
    else await this.client!.set(key, value);
  }

  async del(key: string): Promise<void> {
    if (this.useMemory()) {
      this.memory.delete(key);
      return;
    }
    await this.client!.del(key);
  }

  async onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }
}
