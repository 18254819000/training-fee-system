import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportService } from './report.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentUser, RequestId } from '../../common/decorators/request.decorators';
import { AdminUserInfo, PERM } from '../../common/types';

@ApiTags('管理端-报表')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller('admin/reports')
export class ReportController {
  constructor(private readonly service: ReportService) {}

  @Get('collections')
  @Permissions(PERM.REPORT_READ)
  @ApiOperation({ summary: '收费统计（应收/实收/退款/欠费）' })
  collections(
    @CurrentUser() user: AdminUserInfo,
    @Query() query: Record<string, string>,
  ) {
    return this.service.collections(user, query);
  }

  @Post('exports')
  @Permissions(PERM.REPORT_READ)
  @ApiOperation({ summary: '创建导出任务（返回 taskId；类型 orders_csv/invoices_csv/students_csv）' })
  createExport(
    @CurrentUser() user: AdminUserInfo,
    @Body() body: { type: string; filters?: Record<string, unknown> },
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.service.createExport(user, body?.type, body?.filters, requestId, ip);
  }

  @Get('exports/:taskId')
  @Permissions(PERM.REPORT_READ)
  @ApiOperation({ summary: '查询导出任务状态（含 downloadUrl）' })
  getTask(@CurrentUser() user: AdminUserInfo, @Param('taskId') taskId: string) {
    return this.service.getExportTask(user, taskId);
  }

  @Get('exports/:taskId/download')
  @Permissions(PERM.REPORT_READ)
  @ApiOperation({ summary: '下载导出文件（CSV，24 小时内有效）' })
  async download(
    @CurrentUser() user: AdminUserInfo,
    @Param('taskId') taskId: string,
    @Res() res: Response,
  ) {
    const { path, fileName } = await this.service.downloadPath(user, taskId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.sendFile(path);
  }
}
