import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminUserService } from './admin-user.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentUser, RequestId } from '../../common/decorators/request.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AdminUserInfo, PERM } from '../../common/types';

@ApiTags('管理端-管理员与角色')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller('admin')
export class AdminUserController {
  constructor(private readonly service: AdminUserService) {}

  // ─── 管理员 ───

  @Get('users')
  @Permissions(PERM.ADMIN_USER_MANAGE)
  @ApiOperation({ summary: '管理员列表' })
  listUsers(@Query() query: PaginationDto & Record<string, any>) {
    return this.service.listUsers(query);
  }

  @Post('users')
  @Permissions(PERM.ADMIN_USER_MANAGE)
  @ApiOperation({ summary: '创建管理员' })
  createUser(
    @CurrentUser() user: AdminUserInfo,
    @Body() body: { username: string; password: string; roles: string[]; campus_ids?: string[] },
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.createUser(user, body, requestId, ip);
  }

  @Get('users/:id')
  @Permissions(PERM.ADMIN_USER_MANAGE)
  @ApiOperation({ summary: '管理员详情' })
  getUser(@Param('id') id: string) {
    return this.service.getUser(id);
  }

  @Patch('users/:id')
  @Permissions(PERM.ADMIN_USER_MANAGE)
  @ApiOperation({ summary: '更新管理员（密码/状态/角色/校区；密码留空表示不修改）' })
  updateUser(
    @CurrentUser() user: AdminUserInfo,
    @Param('id') id: string,
    @Body() body: { password?: string; status?: string; roles?: string[]; campus_ids?: string[] },
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.updateUser(user, id, body, requestId, ip);
  }

  @Delete('users/:id')
  @Permissions(PERM.ADMIN_USER_MANAGE)
  @ApiOperation({ summary: '删除管理员（不能删自己/最后一个超管）' })
  deleteUser(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.deleteUser(user, id, requestId, ip);
  }

  @Post('users/:id/unlock')
  @Permissions(PERM.ADMIN_USER_MANAGE)
  @ApiOperation({ summary: '解锁被锁定的管理员' })
  unlockUser(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.unlockUser(user, id, requestId, ip);
  }

  // ─── 角色 ───

  @Get('roles')
  @Permissions(PERM.ADMIN_USER_MANAGE)
  @ApiOperation({ summary: '角色列表（含权限码）' })
  listRoles() {
    return this.service.listRoles();
  }

  @Post('roles')
  @Permissions(PERM.ADMIN_USER_MANAGE)
  @ApiOperation({ summary: '创建角色' })
  createRole(
    @CurrentUser() user: AdminUserInfo,
    @Body() body: { code: string; name: string; permissions: string[] },
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.createRole(user, body, requestId, ip);
  }

  @Patch('roles/:id')
  @Permissions(PERM.ADMIN_USER_MANAGE)
  @ApiOperation({ summary: '更新角色（名称/权限码；编码不可改）' })
  updateRole(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string,
    @Body() body: { name?: string; permissions?: string[] },
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.updateRole(user, id, body, requestId, ip);
  }

  @Delete('roles/:id')
  @Permissions(PERM.ADMIN_USER_MANAGE)
  @ApiOperation({ summary: '删除角色（内置角色/有用户使用时不可删）' })
  deleteRole(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.deleteRole(user, id, requestId, ip);
  }

  // ─── 审计日志 ───

  @Get('audit-logs')
  @Permissions(PERM.AUDIT_READ)
  @ApiOperation({ summary: '审计日志查询' })
  listAuditLogs(@Query() query: PaginationDto & Record<string, any>) {
    return this.service.listAuditLogs(query);
  }
}
