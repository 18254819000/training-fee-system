import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { StudentSessionInfo } from '../types';
import { STUDENT_SESSION_COOKIE } from '../../modules/auth/dto/auth.dto';

// 学生端会话守卫：用于所有 /me/* 接口
// 令牌来源：HttpOnly Cookie（tfs_session，优先）或 Authorization: Bearer（兼容）
// 数据库只存 SHA256 哈希；滑动更新 last_used_at（不延长 expires_at，避免无限续期）
@Injectable()
export class StudentSessionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException({ code: 'ERR_UNAUTHORIZED', message: '请先使用登录码登录' });
    }

    const session = await this.prisma.studentSession.findUnique({
      where: { token_hash: this.crypto.hashToken(token) },
    });
    if (!session || session.expires_at <= new Date()) {
      throw new UnauthorizedException({ code: 'ERR_SESSION_EXPIRED', message: '会话已过期，请重新登录' });
    }

    await this.prisma.studentSession.update({
      where: { id: session.id },
      data: { last_used_at: new Date() },
    });

    const info: StudentSessionInfo = {
      id: session.id,
      studentIds: (session.student_ids as string[]) || [],
      guardianId: session.guardian_id,
    };
    // 实时刷新学生ID：用 guardian 的手机号重新匹配（学生重建后旧ID失效）
    if (info.guardianId) {
      const guardian = await this.prisma.guardian.findUnique({
        where: { id: info.guardianId },
        select: { phone: true },
      });
      if (guardian?.phone) {
        try {
          const phone = this.crypto.decryptField(guardian.phone);
          const students = await this.prisma.student.findMany({
            where: { status: 'active', guardian_phone: { not: null } },
            select: { id: true, guardian_phone: true },
          });
          info.studentIds = students
            .filter((s) => {
              try {
                return this.crypto.decryptField(s.guardian_phone) === phone;
              } catch {
                return false;
              }
            })
            .map((s) => s.id);
        } catch {
          // 解密失败则保留会话原有ID
        }
      }
    }
    req.studentSession = info;
    return true;
  }

  private extractToken(req: any): string | null {
    const fromCookie = req.cookies?.[STUDENT_SESSION_COOKIE];
    if (fromCookie) return fromCookie;
    const h = req.headers?.authorization;
    return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : null;
  }
}
