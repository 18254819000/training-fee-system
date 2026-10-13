import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

// 审计服务：关键操作统一记录
// 铁律：metadata 必须脱敏（密码/密钥/令牌/登录码一律不记录）；IP 只存掩码形式
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  private maskIp(ip: string): string {
    if (!ip) return '';
    // IPv4 掩最后一段；IPv6 只保留前 4 组
    if (ip.includes('.') && !ip.includes(':')) {
      const parts = ip.split('.');
      if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
    }
    if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':') + ':*';
    return '*';
  }

  private redact(value: unknown): unknown {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map((v) => this.redact(v));
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        // 敏感键一律脱敏：密码、密钥、令牌、登录码、证书、私钥
        if (/password|secret|private|token|code|credential|passwd|pwd/i.test(k)) {
          out[k] = '***REDACTED***';
        } else {
          out[k] = this.redact(v);
        }
      }
      return out;
    }
    return value;
  }

  async log(params: {
    actorType: 'admin' | 'student' | 'system';
    actorId?: string | null;
    action: string;
    resourceType?: string;
    resourceId?: string | null;
    result: 'success' | 'fail';
    requestId?: string;
    ip?: string;
    metadata?: unknown;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actor_type: params.actorType,
          actor_id: params.actorId ?? null,
          action: params.action,
          resource_type: params.resourceType ?? null,
          resource_id: params.resourceId ?? null,
          result: params.result,
          request_id: params.requestId ?? null,
          ip_masked: params.ip ? this.maskIp(params.ip) : null,
          metadata_redacted: (this.redact(params.metadata) as any) ?? null,
        },
      });
    } catch {
      // 审计写入失败不能阻断主流程（已在日志中体现）；此处静默
    }
  }
}
