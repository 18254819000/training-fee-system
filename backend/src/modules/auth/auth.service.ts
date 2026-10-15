import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { CookieOptions, Response } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { AdminLoginDto, BindDto, ExchangeCodeDto, PhoneLoginDto, STUDENT_SESSION_COOKIE } from './dto/auth.dto';

// 认证服务：管理员账号密码登录 + 学生端登录码兑换/绑定/会话
// 学生端会话机制：bind 成功后服务端下发 HttpOnly Cookie（tfs_session），
// 前端 withCredentials 自动携带；同时兼容 Authorization Bearer（旧客户端/调试）
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // 密码比对的假哈希：用户不存在时也执行一次比对，抹平时间差异（防用户名枚举计时攻击）
  private readonly dummyHash = '$2a$10$abcdefghijklmnopqrstuuXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly rateLimit: RateLimitService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  private sessionCookieOptions(): CookieOptions {
    const ttlDays = parseInt(process.env.STUDENT_SESSION_TTL_DAYS || '30', 10);
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      // 前后端跨域（pages.dev → onrender.com），必须 SameSite=None 浏览器才会发送 Cookie
      sameSite: 'none',
      path: '/',
      maxAge: ttlDays * 24 * 3600 * 1000,
    };
  }

  // ─── 管理员登录 ───

  async adminLogin(dto: AdminLoginDto, ip: string, requestId: string) {
    // 限流：同 IP 20次/分钟；同用户名 10次/10分钟
    const ipOk = await this.rateLimit.hit(`admin-login-ip:${ip}`, 20, 60);
    const userOk = await this.rateLimit.hit(`admin-login-user:${dto.username}`, 10, 600);
    if (!ipOk || !userOk) {
      await this.audit.log({ actorType: 'admin', action: 'admin.login', result: 'fail', requestId, ip, metadata: { username: dto.username, reason: 'rate_limited' } });
      throw new TooManyRequestsException({ code: 'ERR_RATE_LIMITED', message: '尝试过于频繁，请稍后再试' });
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { username: dto.username },
      include: { admin_user_roles: { include: { role: true } }, admin_user_campuses: true },
    });

    const passwordOk = await bcrypt.compare(dto.password, admin?.password_hash || this.dummyHash);
    if (!admin || admin.status !== 'active' || !passwordOk) {
      if (admin && passwordOk === false) await this.handleFailedLogin(admin.id);
      await this.audit.log({ actorType: 'admin', action: 'admin.login', result: 'fail', requestId, ip, metadata: { username: dto.username } });
      // 统一文案：不透露是用户名错还是密码错（验收 F-01）
      throw new UnauthorizedException({ code: 'ERR_BAD_CREDENTIALS', message: '用户名或密码错误' });
    }
    if (admin.locked_until && admin.locked_until > new Date()) {
      throw new UnauthorizedException({ code: 'ERR_ACCOUNT_LOCKED', message: '账号已锁定，请稍后再试' });
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { failed_logins: 0, locked_until: null, last_login_at: new Date() },
    });

    const roles = admin.admin_user_roles.map((r) => r.role.code);
    const roleNames = admin.admin_user_roles.map((r) => r.role.name);
    const permissions = Array.from(new Set(admin.admin_user_roles.flatMap((r) => (r.role.permissions as string[]) || [])));
    const accessToken = this.jwt.sign({ sub: admin.id, username: admin.username });
    const campusIds = admin.admin_user_campuses.map((c) => c.campus_id);
    const campusList = campusIds.length > 0
      ? await this.prisma.campus.findMany({ where: { id: { in: campusIds } }, select: { id: true, name: true } })
      : [];

    await this.audit.log({ actorType: 'admin', actorId: admin.id, action: 'admin.login', result: 'success', requestId, ip });
    return {
      access_token: accessToken,
      token: accessToken, // 前端管理端期望的字段名（兼容）
      token_type: 'Bearer',
      user: {
        id: admin.id,
        username: admin.username,
        roles,
        role_names: roleNames,
        permissions,
        campus_ids: campusIds,
        campuses: campusList,
      },
    };
  }

  async adminLogout(adminId: string, requestId: string, ip: string) {
    await this.audit.log({ actorType: 'admin', actorId: adminId, action: 'admin.logout', result: 'success', requestId, ip });
    return { ok: true };
  }

  /** 管理员修改自己的密码：验证旧密码后更新 */
  async changePassword(adminId: string, oldPassword: string, newPassword: string, requestId: string, ip: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) throw new BadRequestException({ code: 'ERR_NOT_FOUND', message: '账号不存在' });
    const ok = await bcrypt.compare(oldPassword, admin.password_hash);
    if (!ok) throw new BadRequestException({ code: 'ERR_PASSWORD_WRONG', message: '当前密码不正确' });
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { password_hash: await bcrypt.hash(newPassword, 10), failed_logins: 0, locked_until: null },
    });
    await this.audit.log({ actorType: 'admin', actorId: adminId, action: 'admin.change_password', result: 'success', requestId, ip });
    return { ok: true };
  }

  private async handleFailedLogin(adminId: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) return;
    const failed = admin.failed_logins + 1;
    // 连续失败 10 次锁定 30 分钟（验收 F-01 失败限制）
    const lockedUntil = failed >= 10 ? new Date(Date.now() + 30 * 60 * 1000) : admin.locked_until;
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { failed_logins: failed, locked_until: lockedUntil },
    });
  }

  // ─── 学生端：登录码兑换（第 1 步：验证） ───

  async exchangeCode(dto: ExchangeCodeDto, ip: string, requestId: string) {
    const ipOk = await this.rateLimit.hit(`code-exchange:${ip}`, 20, 60);
    if (!ipOk) {
      throw new TooManyRequestsException({ code: 'ERR_RATE_LIMITED', message: '尝试过于频繁，请稍后再试' });
    }

    const maxFailed = parseInt(process.env.LOGIN_CODE_MAX_FAILED || '10', 10);
    const hash = this.crypto.hashLoginCode(dto.code);
    const record = await this.prisma.loginCode.findUnique({
      where: { code_hash: hash },
      include: { student: { include: { campus: true } } },
    });

    // 统一失败文案：不透露登录码是否存在（防枚举，验收 F-07）
    const invalid = () =>
      new BadRequestException({ code: 'ERR_INVALID_CODE', message: '登录码无效、已过期或已被使用' });

    if (!record) {
      await this.audit.log({ actorType: 'student', action: 'login-code.exchange', result: 'fail', requestId, ip, metadata: { reason: 'not_found' } });
      throw invalid();
    }
    if (record.used_at || record.revoked_at || record.expires_at <= new Date() || record.failed_attempts >= maxFailed) {
      await this.prisma.loginCode.update({
        where: { id: record.id },
        data: { failed_attempts: { increment: 1 } },
      });
      await this.audit.log({ actorType: 'student', action: 'login-code.exchange', result: 'fail', requestId, ip, metadata: { reason: 'invalid_state' } });
      throw invalid();
    }
    if (record.student.status !== 'active') {
      throw invalid();
    }

    // 生成一次性兑换凭证（10 分钟有效），下一步 bind 消费
    // 使用无状态 JWT（不依赖 Redis/内存，多实例/重启不丢失；一次性由 DB 的 used_at 保证）
    const exchangeToken = await this.jwt.signAsync(
      { loginCodeId: record.id, studentId: record.student_id, purpose: 'login-code-exchange' },
      { expiresIn: '10m' },
    );

    await this.audit.log({
      actorType: 'student', action: 'login-code.exchange', result: 'success',
      requestId, ip, metadata: { student_id: record.student_id },
    });
    return {
      exchange_token: exchangeToken,
      need_confirm: true,
      student: {
        id: record.student.id,
        name: this.maskName(record.student.name),
        campus_name: record.student.campus.name,
        grade_or_class: record.student.grade_or_class,
      },
    };
  }

  // ─── 学生端：确认绑定（第 2 步），建立会话并下发 Cookie ───

  async bind(
    dto: BindDto, existingSessionToken: string | null,
    res: Response, ip: string, requestId: string,
  ) {
    let loginCodeId: string;
    let studentId: string;
    try {
      const payload = await this.jwt.verifyAsync(dto.exchange_token);
      if (payload.purpose !== 'login-code-exchange' || !payload.loginCodeId || !payload.studentId) {
        throw new Error('bad purpose');
      }
      loginCodeId = payload.loginCodeId;
      studentId = payload.studentId;
    } catch {
      throw new BadRequestException({ code: 'ERR_INVALID_EXCHANGE_TOKEN', message: '兑换已过期，请重新输入登录码' });
    }

    // 事务：复验登录码状态 → 标记已使用 → 撤销该学生其他未用码（防一码多发）
    await this.prisma.$transaction(async (tx) => {
      const rec = await tx.loginCode.findUnique({ where: { id: loginCodeId } });
      if (!rec || rec.used_at || rec.revoked_at || rec.expires_at <= new Date()) {
        throw new BadRequestException({ code: 'ERR_INVALID_CODE', message: '登录码无效、已过期或已被使用' });
      }
      await tx.loginCode.update({ where: { id: loginCodeId }, data: { used_at: new Date() } });
      await tx.loginCode.updateMany({
        where: { student_id: studentId, used_at: null, revoked_at: null, id: { not: loginCodeId } },
        data: { revoked_at: new Date() },
      });
    });

    // 会话：多孩子家庭可在同一会话追加绑定（分别建立授权关系，验收 F-08）
    let sessionId: string;
    let guardianId: string | null = null;
    let token: string;
    if (existingSessionToken) {
      const existing = await this.prisma.studentSession.findUnique({
        where: { token_hash: this.crypto.hashToken(existingSessionToken) },
      });
      if (existing && existing.expires_at > new Date()) {
        const ids = new Set<string>([...((existing.student_ids as string[]) || []), studentId]);
        await this.prisma.studentSession.update({
          where: { id: existing.id },
          data: { student_ids: Array.from(ids), last_used_at: new Date() },
        });
        sessionId = existing.id;
        guardianId = existing.guardian_id;
        token = existingSessionToken;
      } else {
        ({ sessionId, token } = await this.createSession(studentId));
      }
    } else {
      ({ sessionId, token } = await this.createSession(studentId));
    }

    // 建立家长绑定关系（简化模型：每会话一个家长账号）
    if (!guardianId) {
      const guardian = await this.prisma.guardian.create({ data: {} });
      guardianId = guardian.id;
      await this.prisma.studentSession.update({ where: { id: sessionId }, data: { guardian_id: guardianId } });
    }
    await this.prisma.studentGuardian.upsert({
      where: { student_id_guardian_id: { student_id: studentId, guardian_id: guardianId } },
      update: { verified_at: new Date() },
      create: { student_id: studentId, guardian_id: guardianId, verified_at: new Date() },
    });

    await this.audit.log({
      actorType: 'student', actorId: guardianId, action: 'login-code.bind', result: 'success',
      requestId, ip, metadata: { student_id: studentId },
    });

    // 下发会话 Cookie（HttpOnly，前端 withCredentials 自动携带）
    res.cookie(STUDENT_SESSION_COOKIE, token, this.sessionCookieOptions());

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { campus: true },
    });
    return {
      student: student
        ? { id: student.id, name: this.maskName(student.name), campus_name: student.campus.name, grade_or_class: student.grade_or_class }
        : null,
    };
  }

  private async createSession(studentId: string): Promise<{ sessionId: string; token: string }> {
    const token = this.crypto.randomHex(32);
    const ttlDays = parseInt(process.env.STUDENT_SESSION_TTL_DAYS || '30', 10);
    const session = await this.prisma.studentSession.create({
      data: {
        token_hash: this.crypto.hashToken(token),
        student_ids: [studentId],
        expires_at: new Date(Date.now() + ttlDays * 24 * 3600 * 1000),
      },
    });
    return { sessionId: session.id, token };
  }

  // ─── 学生端：手机号登录（一个手机号可绑定多个学生） ───
  // TODO: 后续加姓名二次验证（用户确认后）

  async phoneLogin(dto: PhoneLoginDto, res: Response, ip: string, requestId: string) {
    const ipOk = await this.rateLimit.hit(`phone-login:${ip}`, 20, 60);
    if (!ipOk) {
      throw new TooManyRequestsException({ code: 'ERR_RATE_LIMITED', message: '尝试过于频繁，请稍后再试' });
    }

    // 手机号加密存储，需解密比对（学校规模小，全量扫描可接受）
    const candidates = await this.prisma.student.findMany({
      where: { status: 'active', guardian_phone: { not: null } },
      include: { campus: true },
    });
    const matched = candidates.filter((s) => {
      try {
        return this.crypto.decryptField(s.guardian_phone) === dto.phone;
      } catch {
        return false;
      }
    });

    // 未录入的手机号也允许登录：建空学生列表的会话，前端仅展示空状态（无账单）
    if (matched.length === 0) {
      await this.audit.log({ actorType: 'student', action: 'phone-login', result: 'success', requestId, ip, metadata: { reason: 'empty_session' } });
    }

    // 建会话（含该手机号下所有学生 ID）
    const token = this.crypto.randomHex(32);
    const ttlDays = parseInt(process.env.STUDENT_SESSION_TTL_DAYS || '30', 10);
    const studentIds = matched.map((s) => s.id);
    const session = await this.prisma.studentSession.create({
      data: {
        token_hash: this.crypto.hashToken(token),
        student_ids: studentIds,
        expires_at: new Date(Date.now() + ttlDays * 24 * 3600 * 1000),
      },
    });

    // 建家长绑定关系
    const guardian = await this.prisma.guardian.create({ data: {} });
    await this.prisma.studentSession.update({ where: { id: session.id }, data: { guardian_id: guardian.id } });
    for (const s of matched) {
      await this.prisma.studentGuardian.upsert({
        where: { student_id_guardian_id: { student_id: s.id, guardian_id: guardian.id } },
        update: { verified_at: new Date() },
        create: { student_id: s.id, guardian_id: guardian.id, verified_at: new Date() },
      });
    }

    await this.audit.log({
      actorType: 'student', actorId: guardian.id, action: 'phone-login', result: 'success',
      requestId, ip, metadata: { student_ids: studentIds },
    });

    res.cookie(STUDENT_SESSION_COOKIE, token, this.sessionCookieOptions());

    return {
      // 响应体也返回 token：微信内置浏览器可能拦截跨域 Cookie，
      // 前端存入 localStorage 后走 Authorization: Bearer 兼容通道
      sessionToken: token,
      students: matched.map((s) => ({
        id: s.id,
        name: this.maskName(s.name),
        campus_name: s.campus.name,
        grade_or_class: s.grade_or_class,
      })),
    };
  }

  async logout(sessionToken: string | null, res: Response): Promise<void> {
    if (sessionToken) {
      await this.prisma.studentSession.deleteMany({ where: { token_hash: this.crypto.hashToken(sessionToken) } });
    }
    res.clearCookie(STUDENT_SESSION_COOKIE, { path: '/' });
  }

  private maskName(name: string): string {
    if (!name) return '';
    if (name.length <= 1) return '*';
    if (name.length === 2) return name[0] + '*';
    return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
  }

  /** 小程序 code 换 openid 并绑定到当前会话的家长 */
  async mpBind(code: string, authHeader: string | undefined, requestId: string) {
    if (!code) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '缺少 code' });
    }
    // 从 Authorization: Bearer <sessionToken> 解析会话
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException({ code: 'ERR_UNAUTHORIZED', message: '未登录' });
    }
    const session = await this.prisma.studentSession.findFirst({
      where: { token_hash: this.crypto.hashToken(token) },
    });
    if (!session || !session.guardian_id) {
      throw new UnauthorizedException({ code: 'ERR_UNAUTHORIZED', message: '会话无效' });
    }

    // 用 code 换 openid：从启用的支付账号取 appid + appsecret
    const account = await this.prisma.paymentAccount.findFirst({
      where: { status: 'active', app_secret_ref: { not: null } },
      orderBy: { updated_at: 'desc' },
    });
    if (!account?.app_secret_ref) {
      throw new BadRequestException({ code: 'ERR_MP_NOT_CONFIGURED', message: '支付账号尚未配置小程序 AppSecret' });
    }
    const appid = account.app_id;
    const secret = this.crypto.resolveSecretRef(account.app_secret_ref, '小程序 AppSecret');
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
    const res = await fetch(url);
    const data = await res.json() as any;
    if (!data.openid) {
      throw new BadRequestException({ code: 'ERR_MP_CODE', message: `换取 openid 失败：${data.errmsg || '未知错误'}` });
    }

    await this.prisma.guardian.update({
      where: { id: session.guardian_id },
      data: { wechat_openid: data.openid },
    });
    return { openid: data.openid };
  }

  /** 小程序 getPhoneNumber 的 code 换真实手机号 */
  async mpPhone(code: string) {
    if (!code) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '缺少 code' });
    }
    const account = await this.prisma.paymentAccount.findFirst({
      where: { status: 'active', app_secret_ref: { not: null } },
      orderBy: { updated_at: 'desc' },
    });
    if (!account?.app_secret_ref) {
      throw new BadRequestException({ code: 'ERR_MP_NOT_CONFIGURED', message: '支付账号尚未配置小程序 AppSecret' });
    }
    // 先用 jscode2session 换 access_token（需小程序 appid/secret）
    const appid = account.app_id;
    const secret = this.crypto.resolveSecretRef(account.app_secret_ref, '小程序 AppSecret');
    const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      throw new BadRequestException({ code: 'ERR_MP_TOKEN', message: `获取 access_token 失败：${tokenData.errmsg || '未知错误'}` });
    }
    const url = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${tokenData.access_token}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json() as any;
    if (data.errcode !== 0 || !data.phone_info?.phoneNumber) {
      throw new BadRequestException({ code: 'ERR_MP_PHONE', message: `获取手机号失败：${data.errmsg || '未知错误'}` });
    }
    return { phone: data.phone_info.phoneNumber };
  }
}
