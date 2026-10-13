import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { AdminUserInfo } from '../types';

// 管理员 JWT 守卫：用于所有 /admin/* 接口
// 校验：token 有效 → 用户存在且启用且未锁定 → 注入 roles/permissions/campusIds
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException({ code: 'ERR_UNAUTHORIZED', message: '未登录或登录已过期' });

    let payload: any;
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException({ code: 'ERR_UNAUTHORIZED', message: '未登录或登录已过期' });
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      include: {
        admin_user_roles: { include: { role: true } },
        admin_user_campuses: true,
      },
    });
    if (!admin || admin.status !== 'active') {
      throw new UnauthorizedException({ code: 'ERR_UNAUTHORIZED', message: '账号不存在或已停用' });
    }
    if (admin.locked_until && admin.locked_until > new Date()) {
      throw new UnauthorizedException({ code: 'ERR_ACCOUNT_LOCKED', message: '账号已锁定，请稍后再试' });
    }

    const roles = admin.admin_user_roles.map((r) => r.role.code);
    const permissions = Array.from(
      new Set(admin.admin_user_roles.flatMap((r) => (r.role.permissions as string[]) || [])),
    );
    const campusIds = admin.admin_user_campuses.map((c) => c.campus_id);

    const user: AdminUserInfo = { id: admin.id, username: admin.username, roles, permissions, campusIds };
    req.user = user;
    return true;
  }

  private extractToken(req: any): string | null {
    const h = req.headers?.authorization;
    if (!h || typeof h !== 'string') return null;
    const [type, token] = h.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
