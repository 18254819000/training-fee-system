import { Controller, Delete, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/auth.decorators';
import { PERM } from '../../common/types';
import { ErrorLogStore } from '../../common/error-log/error-log.store';

@ApiTags('管理端-系统')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller('admin/system')
export class SystemController {
  constructor(private readonly errorLogStore: ErrorLogStore) {}

  @Get('error-logs')
  @Permissions(PERM.AUDIT_READ)
  @ApiOperation({ summary: '查看服务端错误日志（最近200条，内存）' })
  errorLogs(@Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit || '50', 10) || 50, 1), 200);
    return this.errorLogStore.list(n);
  }

  @Delete('error-logs')
  @Permissions(PERM.AUDIT_READ)
  @ApiOperation({ summary: '清空服务端错误日志' })
  clearErrorLogs() {
    this.errorLogStore.clear();
    return { ok: true };
  }
}
