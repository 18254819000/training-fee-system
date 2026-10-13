import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

// 密码学工具：登录码哈希 / 会话令牌哈希 / PII 字段加密 / 密钥引用解析
// 铁律：数据库、日志、备份中绝不出现登录码明文与支付密钥明文
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);

  /** 密码学安全随机 hex */
  randomHex(bytes: number): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /** 生成一次性登录码：128 bit 熵，格式 xxxx-xxxx-… 便于抄写 */
  generateLoginCode(bytes = 16): string {
    const hex = this.randomHex(bytes);
    return hex.replace(/(.{4})/g, '$1-').replace(/-$/, '');
  }

  /** 登录码哈希：HMAC-SHA256(pepper, 规范化后的登录码)。pepper 放在环境变量，不进数据库 */
  hashLoginCode(code: string): string {
    const pepper = process.env.LOGIN_CODE_PEPPER || 'dev-only-pepper-change-me';
    const normalized = code.replace(/-/g, '').toLowerCase();
    return crypto.createHmac('sha256', pepper).update(normalized).digest('hex');
  }

  /** 会话令牌哈希：SHA256（令牌本身 256 bit 随机，无需 pepper） */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /** 通用摘要（用于通知报文去重等） */
  sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // ─── PII 字段加密（AES-256-GCM，主密钥来自 MASTER_KEY 环境变量） ───

  private getMasterKey(): Buffer | null {
    const hex = process.env.MASTER_KEY || '';
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
    return Buffer.from(hex, 'hex');
  }

  /** 加密 PII（如手机号）。未配置 MASTER_KEY 时返回原文并打警告（仅允许开发环境） */
  encryptField(plain: string | null | undefined): string | null {
    if (plain == null || plain === '') return plain ?? null;
    const key = this.getMasterKey();
    if (!key) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('生产环境必须配置 MASTER_KEY 才能存储 PII');
      }
      this.logger.warn('未配置 MASTER_KEY，PII 将以明文存储（仅限开发环境）');
      return plain;
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:v1:${iv.toString('base64')}:${enc.toString('base64')}:${tag.toString('base64')}`;
  }

  decryptField(value: string | null | undefined): string | null {
    if (value == null || value === '') return value ?? null;
    if (!value.startsWith('enc:v1:')) return value; // 兼容开发环境明文
    const key = this.getMasterKey();
    if (!key) throw new Error('MASTER_KEY 未配置，无法解密 PII');
    const [, , ivB64, encB64, tagB64] = value.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
  }

  /** 手机号脱敏：138****8000 */
  maskPhone(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const p = phone.replace(/\D/g, '');
    if (p.length < 7) return '****';
    return `${p.slice(0, 3)}****${p.slice(-4)}`;
  }

  // ─── 支付密钥引用解析 ───
  // 合法格式：env:VAR_NAME（从环境变量读取） / enc:v1:...（主密钥解密） / kms:...（未实现，显式报错）
  // 拒绝任何无前缀的明文，避免误把密钥原文写入配置表
  resolveSecretRef(ref: string | null | undefined, label: string): string {
    if (!ref) throw new Error(`${label} 未配置`);
    if (ref.startsWith('env:')) {
      const name = ref.slice(4);
      const v = process.env[name];
      if (!v) throw new Error(`${label} 引用的环境变量 ${name} 未设置`);
      return v;
    }
    if (ref.startsWith('enc:v1:')) {
      const dec = this.decryptField(ref);
      if (!dec) throw new Error(`${label} 解密失败`);
      return dec;
    }
    if (ref.startsWith('kms:')) {
      throw new Error(`${label} 使用 KMS 引用，当前版本未实现 KMS 对接，请改用 env: 或 enc: 引用`);
    }
    throw new Error(`${label} 必须是 env:/enc:/kms: 引用格式，拒绝明文存储`);
  }
}
