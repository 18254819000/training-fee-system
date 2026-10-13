import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CampusScopeService } from '../../common/guards/campus-scope.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserInfo } from '../../common/types';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { BatchIssueDto, LoginCodeQueryDto } from './dto/login-code.dto';

// 登录码服务：签发（只存 HMAC 哈希）、撤销、重新签发、状态查询
// 铁律：明文只在签发时返回一次；数据库/日志/导出中永不出现明文
@Injectable()
export class LoginCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly scope: CampusScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(
    user: AdminUserInfo,
    query: PaginationDto & LoginCodeQueryDto,
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: any = {};
    const scopeFilter = this.scope.scopeFilter(user);
    if (query.student_id) where.student_id = query.student_id;
    if (query.campus_id) {
      this.scope.assertCampus(user, query.campus_id, '校区');
      where.student = { campus_id: query.campus_id };
    } else if (scopeFilter) {
      where.student = { campus_id: scopeFilter };
    }
    const now = new Date();
    if (query.state === 'valid') {
      where.used_at = null; where.revoked_at = null; where.expires_at = { gt: now };
    } else if (query.state === 'used') {
      where.used_at = { not: null };
    } else if (query.state === 'revoked') {
      where.revoked_at = { not: null };
    } else if (query.state === 'expired') {
      where.used_at = null; where.expires_at = { lte: now };
    }
    const [total, items] = await Promise.all([
      this.prisma.loginCode.count({ where }),
      this.prisma.loginCode.findMany({
        where,
        include: { student: { select: { id: true, name: true, student_no: true, campus_id: true } } },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    // 返回状态摘要，不返回任何可用作凭证的值
    const mapped = items.map((c) => ({
      id: c.id,
      student: c.student,
      state: this.stateOf(c),
      expires_at: c.expires_at,
      used_at: c.used_at,
      revoked_at: c.revoked_at,
      failed_attempts: c.failed_attempts,
      created_at: c.created_at,
    }));
    return paginate(mapped, total, page, pageSize);
  }

  private stateOf(c: { used_at: Date | null; revoked_at: Date | null; expires_at: Date }): string {
    if (c.used_at) return 'used';
    if (c.revoked_at) return 'revoked';
    if (c.expires_at <= new Date()) return 'expired';
    return 'valid';
  }

  /** 批量签发：为每个学生生成新码，同时撤销其旧的未使用码（防一码多发） */
  async batchIssue(user: AdminUserInfo, dto: BatchIssueDto, requestId: string, ip: string) {
    if (dto.student_ids.length > 500) {
      throw new BadRequestException({ code: 'ERR_TOO_MANY', message: '单次签发不超过 500 个学生' });
    }
    const expiresAt = new Date(dto.expires_at);
    if (isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      throw new BadRequestException({ code: 'ERR_BAD_EXPIRES', message: '有效期必须是未来的时间' });
    }
    if (expiresAt.getTime() - Date.now() > 365 * 24 * 3600 * 1000) {
      throw new BadRequestException({ code: 'ERR_BAD_EXPIRES', message: '有效期不能超过 365 天' });
    }

    // 预查学生并校验校区范围
    const students = await this.prisma.student.findMany({
      where: { id: { in: dto.student_ids } },
      select: { id: true, name: true, campus_id: true, status: true },
    });
    const found = new Map(students.map((s) => [s.id, s]));
    const codes: Array<{ student_id: string; student_name: string; code: string; expires_at: Date }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const sid of dto.student_ids) {
        const s = found.get(sid);
        if (!s || s.status !== 'active') continue;
        this.scope.assertCampus(user, s.campus_id, '学生');
        // 撤销该学生旧的未使用码
        await tx.loginCode.updateMany({
          where: { student_id: sid, used_at: null, revoked_at: null },
          data: { revoked_at: new Date() },
        });
        const code = this.crypto.generateLoginCode(16); // 128 bit
        await tx.loginCode.create({
          data: {
            student_id: sid,
            code_hash: this.crypto.hashLoginCode(code),
            expires_at: expiresAt,
            issued_by: user.id,
          },
        });
        codes.push({ student_id: sid, student_name: s.name, code, expires_at: expiresAt });
      }
    });

    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'login-code.batch_issue', result: 'success',
      requestId, ip, metadata: { count: codes.length, expires_at: dto.expires_at },
    });
    // 明文只在此返回一次（前端用于打印发放），调用方负责安全发放，服务端不再保存
    return { codes, total: codes.length, warning: '登录码明文仅返回一次，请妥善发放并立即销毁本响应' };
  }

  /** 撤销单个登录码 */
  async revoke(user: AdminUserInfo, id: string, requestId: string, ip: string) {
    const code = await this.prisma.loginCode.findUnique({
      where: { id },
      include: { student: { select: { campus_id: true } } },
    });
    if (!code) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '登录码不存在' });
    this.scope.assertCampus(user, code.student.campus_id, '学生');
    if (code.used_at || code.revoked_at) {
      throw new BadRequestException({ code: 'ERR_CODE_STATE', message: '该登录码已使用或已撤销' });
    }
    await this.prisma.loginCode.update({ where: { id }, data: { revoked_at: new Date() } });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'login-code.revoke', resourceType: 'login_code',
      resourceId: id, result: 'success', requestId, ip,
    });
    return { ok: true };
  }
}
