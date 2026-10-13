import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserInfo } from '../../common/types';
import { AdminUserQueryDto, AuditLogQueryDto } from './dto/admin-user-query.dto';

// 管理员 / 角色 / 审计日志查询
// 铁律：
// - 密码 bcrypt 存储，永不回显
// - 角色 code 创建后不可改；删除角色需无人使用
// - 不能删除自己；不能删除最后一个超管
@Injectable()
export class AdminUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── 管理员 ───

  private maskUser(u: any) {
    return {
      id: u.id,
      username: u.username,
      status: u.status,
      roles: (u.admin_user_roles || []).map((r: any) => r.role.code),
      campus_ids: (u.admin_user_campuses || []).map((c: any) => c.campus_id),
      failed_logins: u.failed_logins,
      locked_until: u.locked_until,
      last_login_at: u.last_login_at,
      created_at: u.created_at,
      updated_at: u.updated_at,
    };
  }

  async listUsers(query: AdminUserQueryDto) {
    const page = query.page || 1;
    const pageSize = Math.min(query.pageSize || 20, 100);
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.keyword) where.username = { contains: query.keyword };
    const [total, items] = await Promise.all([
      this.prisma.adminUser.count({ where }),
      this.prisma.adminUser.findMany({
        where,
        include: {
          admin_user_roles: { include: { role: true } },
          admin_user_campuses: true,
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: items.map((u) => this.maskUser(u)),
      total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize),
    };
  }

  async getUser(id: string) {
    const u = await this.prisma.adminUser.findUnique({
      where: { id },
      include: { admin_user_roles: { include: { role: true } }, admin_user_campuses: true },
    });
    if (!u) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '管理员不存在' });
    return this.maskUser(u);
  }

  private async resolveRoleIds(roleCodes: string[]): Promise<string[]> {
    const roles = await this.prisma.role.findMany({ where: { code: { in: roleCodes } } });
    const found = new Set(roles.map((r) => r.code));
    const missing = roleCodes.filter((c) => !found.has(c));
    if (missing.length > 0) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: `角色不存在：${missing.join(',')}` });
    }
    return roles.map((r) => r.id);
  }

  private async validateCampuses(campusIds: string[]) {
    if (campusIds.length === 0) return;
    const count = await this.prisma.campus.count({ where: { id: { in: campusIds } } });
    if (count !== campusIds.length) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '校区 ID 无效' });
    }
  }

  async createUser(
    actor: AdminUserInfo, body: { username: string; password: string; roles: string[]; campus_ids?: string[] },
    requestId: string, ip: string,
  ) {
    const username = String(body.username || '').trim();
    if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '用户名需为 3-64 位字母数字/._-' });
    }
    if (!body.password || String(body.password).length < 8) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '密码长度至少 8 位' });
    }
    const exists = await this.prisma.adminUser.findUnique({ where: { username } });
    if (exists) throw new ConflictException({ code: 'ERR_DUPLICATE', message: '用户名已存在' });

    const roleIds = await this.resolveRoleIds(body.roles || []);
    const campusIds: string[] = body.campus_ids || [];
    await this.validateCampuses(campusIds);

    const user = await this.prisma.adminUser.create({
      data: {
        username,
        password_hash: await bcrypt.hash(String(body.password), 10),
        admin_user_roles: { create: roleIds.map((role_id) => ({ role_id })) },
        admin_user_campuses: { create: campusIds.map((campus_id) => ({ campus_id })) },
      },
      include: { admin_user_roles: { include: { role: true } }, admin_user_campuses: true },
    });
    await this.audit.log({
      actorType: 'admin', actorId: actor.id, action: 'admin_user.create',
      resourceType: 'admin_user', resourceId: user.id, result: 'success',
      requestId, ip, metadata: { username },
    });
    return this.maskUser(user);
  }

  async updateUser(
    actor: AdminUserInfo, id: string,
    body: { password?: string; status?: string; roles?: string[]; campus_ids?: string[] },
    requestId: string, ip: string,
  ) {
    const existing = await this.prisma.adminUser.findUnique({
      where: { id },
      include: { admin_user_roles: { include: { role: true } } },
    });
    if (!existing) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '管理员不存在' });

    const data: any = {};
    if (body.password !== undefined && body.password !== '') {
      if (String(body.password).length < 8) {
        throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '密码长度至少 8 位' });
      }
      data.password_hash = await bcrypt.hash(String(body.password), 10);
    }
    if (body.status !== undefined) {
      if (!['active', 'disabled'].includes(body.status)) {
        throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: 'status 仅支持 active/disabled' });
      }
      // 不能停用最后一个超管
      if (body.status === 'disabled' && existing.admin_user_roles.some((r) => r.role.code === 'super_admin')) {
        const superCount = await this.prisma.adminUserRole.count({
          where: { role: { code: 'super_admin' }, admin_user: { status: 'active' } },
        });
        if (superCount <= 1) {
          throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '不能停用最后一个超管' });
        }
      }
      data.status = body.status;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (body.roles !== undefined) {
        const roleIds = await this.resolveRoleIds(body.roles);
        await tx.adminUserRole.deleteMany({ where: { admin_user_id: id } });
        if (roleIds.length > 0) {
          await tx.adminUserRole.createMany({
            data: roleIds.map((role_id) => ({ admin_user_id: id, role_id })),
          });
        }
      }
      if (body.campus_ids !== undefined) {
        await this.validateCampuses(body.campus_ids);
        await tx.adminUserCampus.deleteMany({ where: { admin_user_id: id } });
        if (body.campus_ids.length > 0) {
          await tx.adminUserCampus.createMany({
            data: body.campus_ids.map((campus_id: string) => ({ admin_user_id: id, campus_id })),
          });
        }
      }
      return tx.adminUser.update({
        where: { id },
        data,
        include: { admin_user_roles: { include: { role: true } }, admin_user_campuses: true },
      });
    });
    await this.audit.log({
      actorType: 'admin', actorId: actor.id, action: 'admin_user.update',
      resourceType: 'admin_user', resourceId: id, result: 'success', requestId, ip,
    });
    return this.maskUser(updated);
  }

  async deleteUser(actor: AdminUserInfo, id: string, requestId: string, ip: string) {
    if (id === actor.id) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '不能删除自己' });
    }
    const existing = await this.prisma.adminUser.findUnique({
      where: { id },
      include: { admin_user_roles: { include: { role: true } } },
    });
    if (!existing) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '管理员不存在' });
    if (existing.admin_user_roles.some((r) => r.role.code === 'super_admin')) {
      const superCount = await this.prisma.adminUserRole.count({
        where: { role: { code: 'super_admin' } },
      });
      if (superCount <= 1) {
        throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '不能删除最后一个超管' });
      }
    }
    await this.prisma.adminUser.delete({ where: { id } });
    await this.audit.log({
      actorType: 'admin', actorId: actor.id, action: 'admin_user.delete',
      resourceType: 'admin_user', resourceId: id, result: 'success',
      requestId, ip, metadata: { username: existing.username },
    });
    return { deleted: true };
  }

  async unlockUser(actor: AdminUserInfo, id: string, requestId: string, ip: string) {
    const existing = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '管理员不存在' });
    const updated = await this.prisma.adminUser.update({
      where: { id },
      data: { failed_logins: 0, locked_until: null },
      include: { admin_user_roles: { include: { role: true } }, admin_user_campuses: true },
    });
    await this.audit.log({
      actorType: 'admin', actorId: actor.id, action: 'admin_user.unlock',
      resourceType: 'admin_user', resourceId: id, result: 'success', requestId, ip,
    });
    return this.maskUser(updated);
  }

  // ─── 角色 ───

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      include: { _count: { select: { admin_user_roles: true } } },
      orderBy: { code: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id, code: r.code, name: r.name,
      permissions: r.permissions as string[],
      user_count: r._count.admin_user_roles,
      created_at: r.created_at,
    }));
  }

  async createRole(
    actor: AdminUserInfo, body: { code: string; name: string; permissions: string[] },
    requestId: string, ip: string,
  ) {
    const code = String(body.code || '').trim();
    if (!/^[a-z_]{2,32}$/.test(code)) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '角色编码需为 2-32 位小写字母/下划线' });
    }
    if (!body.name || !Array.isArray(body.permissions)) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '缺少 name 或 permissions' });
    }
    const exists = await this.prisma.role.findUnique({ where: { code } });
    if (exists) throw new ConflictException({ code: 'ERR_DUPLICATE', message: '角色编码已存在' });
    const role = await this.prisma.role.create({
      data: { code, name: String(body.name).trim(), permissions: body.permissions },
    });
    await this.audit.log({
      actorType: 'admin', actorId: actor.id, action: 'role.create',
      resourceType: 'role', resourceId: role.id, result: 'success',
      requestId, ip, metadata: { code },
    });
    return role;
  }

  async updateRole(
    actor: AdminUserInfo, id: string, body: { name?: string; permissions?: string[] },
    requestId: string, ip: string,
  ) {
    const existing = await this.prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '角色不存在' });
    const data: any = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.permissions !== undefined) {
      if (!Array.isArray(body.permissions)) {
        throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: 'permissions 必须为数组' });
      }
      data.permissions = body.permissions;
    }
    const role = await this.prisma.role.update({ where: { id }, data });
    await this.audit.log({
      actorType: 'admin', actorId: actor.id, action: 'role.update',
      resourceType: 'role', resourceId: id, result: 'success', requestId, ip,
    });
    return role;
  }

  async deleteRole(actor: AdminUserInfo, id: string, requestId: string, ip: string) {
    const existing = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { admin_user_roles: true } } },
    });
    if (!existing) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '角色不存在' });
    if (['super_admin', 'finance', 'campus_admin', 'operator'].includes(existing.code)) {
      throw new ForbiddenException({ code: 'ERR_FORBIDDEN', message: '内置角色不能删除' });
    }
    if (existing._count.admin_user_roles > 0) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '该角色仍有用户使用，不能删除' });
    }
    await this.prisma.role.delete({ where: { id } });
    await this.audit.log({
      actorType: 'admin', actorId: actor.id, action: 'role.delete',
      resourceType: 'role', resourceId: id, result: 'success', requestId, ip,
    });
    return { deleted: true };
  }

  // ─── 审计日志查询 ───

  async listAuditLogs(query: AuditLogQueryDto) {
    const page = query.page || 1;
    const pageSize = Math.min(query.pageSize || 20, 100);
    const where: any = {};
    if (query.action) where.action = { contains: query.action };
    if (query.actor_type) where.actor_type = query.actor_type;
    if (query.result) where.result = query.result;
    if (query.keyword) {
      where.OR = [
        { action: { contains: query.keyword } },
        { resource_type: { contains: query.keyword } },
        { resource_id: { contains: query.keyword } },
        { actor_id: { contains: query.keyword } },
      ];
    }
    if (query.date_from || query.date_to) {
      where.created_at = {};
      if (query.date_from) where.created_at.gte = new Date(query.date_from);
      if (query.date_to) where.created_at.lte = new Date(query.date_to);
    }
    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where, orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);
    return { items, total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize) };
  }
}
