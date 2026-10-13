import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

// 业务单号生成：时间戳 + 密码学随机，保证全局唯一倾向；
// 数据库唯一约束是最终防线，冲突时上层重试
@Injectable()
export class IdService {
  private stamp(): string {
    const d = new Date();
    const p = (n: number, l = 2) => String(n).padStart(l, '0');
    return (
      `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
      `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
    );
  }

  private rand(digits: number): string {
    let s = '';
    while (s.length < digits) s += crypto.randomInt(0, 10);
    return s;
  }

  /** 账单号：IV + 时间戳(14) + 6位随机 */
  newInvoiceNo(): string {
    return `IV${this.stamp()}${this.rand(6)}`;
  }

  /** 微信商户订单号：T + 时间戳(14) + 8位随机（微信要求 6~32 位） */
  newOutTradeNo(): string {
    return `T${this.stamp()}${this.rand(8)}`;
  }

  /** 退款单号：RF + 时间戳(14) + 6位随机 */
  newRefundNo(): string {
    return `RF${this.stamp()}${this.rand(6)}`;
  }

  /** 请求追踪 ID */
  newRequestId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /** 学生端会话令牌：256 bit */
  newSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
