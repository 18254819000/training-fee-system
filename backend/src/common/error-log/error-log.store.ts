import { Injectable } from '@nestjs/common';

export interface ErrorLogEntry {
  requestId: string;
  timestamp: string;
  method: string;
  url: string;
  status: number;
  code: string;
  message: string;
  stack?: string;
  username?: string;
}

// 进程内存环形缓冲：保存最近 200 条服务端错误，供管理端查看排查。
// Render 免费版日志保留时间短，这个接口让管理员不进 Render 也能看到报错。
@Injectable()
export class ErrorLogStore {
  private readonly max = 200;
  private readonly logs: ErrorLogEntry[] = [];

  push(entry: ErrorLogEntry): void {
    this.logs.unshift(entry);
    if (this.logs.length > this.max) this.logs.length = this.max;
  }

  list(limit = 50): { items: ErrorLogEntry[]; total: number } {
    const n = Math.min(Math.max(limit, 1), this.max);
    return { items: this.logs.slice(0, n), total: this.logs.length };
  }

  clear(): void {
    this.logs.length = 0;
  }
}
