import { ForbiddenException, Injectable } from '@nestjs/common';
import { AdminUserInfo, ROLE_CODES } from '../types';

// 校区范围校验：不能只靠前端隐藏，后端每个涉及校区资源的查询/写入都要过这一层
// super_admin / finance 可访问全部校区；campus_admin / operator 仅限授权校区
@Injectable()
export class CampusScopeService {
  /** 是否拥有全校区视野 */
  isGlobal(user: AdminUserInfo): boolean {
    return (
      user.permissions.includes('*') ||
      user.roles.includes(ROLE_CODES.SUPER_ADMIN) ||
      user.roles.includes(ROLE_CODES.FINANCE)
    );
  }

  /** 断言用户可访问指定校区，否则 403（不泄露目标是否存在） */
  assertCampus(user: AdminUserInfo, campusId: string | null | undefined, resourceName = '资源'): void {
    if (!campusId) {
      throw new ForbiddenException({ code: 'ERR_FORBIDDEN', message: `无权访问该${resourceName}` });
    }
    if (this.isGlobal(user)) return;
    if (!user.campusIds.includes(campusId)) {
      // 故意使用通用文案：不向越权者透露目标校区是否存在（验收 F-03）
      throw new ForbiddenException({ code: 'ERR_FORBIDDEN', message: `无权访问该${resourceName}` });
    }
  }

  /** 列表查询用的校区过滤条件：返回 undefined 表示不过滤 */
  scopeFilter(user: AdminUserInfo): { in: string[] } | undefined {
    if (this.isGlobal(user)) return undefined;
    return { in: user.campusIds };
  }
}
