import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, ROLES_KEY } from '../decorators/auth.decorators';
import { AdminUserInfo } from '../types';

// 角色/权限守卫：与 AdminJwtGuard 配合使用
// super_admin 拥有 '*' 通配权限，直接放行
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const requiredPerms = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if ((!requiredRoles || requiredRoles.length === 0) && (!requiredPerms || requiredPerms.length === 0)) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AdminUserInfo;
    if (!user) throw new ForbiddenException({ code: 'ERR_FORBIDDEN', message: '无访问权限' });
    if (user.permissions.includes('*')) return true;

    if (requiredRoles && requiredRoles.length > 0) {
      if (!requiredRoles.some((r) => user.roles.includes(r))) {
        throw new ForbiddenException({ code: 'ERR_FORBIDDEN', message: '角色权限不足' });
      }
    }
    if (requiredPerms && requiredPerms.length > 0) {
      if (!requiredPerms.some((p) => user.permissions.includes(p))) {
        throw new ForbiddenException({ code: 'ERR_FORBIDDEN', message: '操作权限不足' });
      }
    }
    return true;
  }
}
