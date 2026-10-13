import {
  Body, Controller, Get, Param, Patch, Post, Query,
  Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { StudentService } from './student.service';
import { CreateStudentDto, StudentQueryDto, UpdateStudentDto } from './dto/student.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentUser, RequestId } from '../../common/decorators/request.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AdminUserInfo, PERM } from '../../common/types';

@ApiTags('管理端-学生')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller()
export class StudentController {
  constructor(private readonly service: StudentService) {}

  @Get('admin/students')
  @Permissions(PERM.STUDENT_READ)
  @ApiOperation({ summary: '学生列表' })
  list(
    @CurrentUser() user: AdminUserInfo,
    @Query() query: StudentQueryDto,
  ) {
    return this.service.list(user, query);
  }

  @Post('admin/students')
  @Permissions(PERM.STUDENT_WRITE)
  @ApiOperation({ summary: '新增学生' })
  create(
    @CurrentUser() user: AdminUserInfo,
    @Body() dto: CreateStudentDto,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.service.create(user, dto, requestId, ip);
  }

  @Get('admin/students/:id')
  @Permissions(PERM.STUDENT_READ)
  @ApiOperation({ summary: '学生详情' })
  get(@CurrentUser() user: AdminUserInfo, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Patch('admin/students/:id')
  @Permissions(PERM.STUDENT_WRITE)
  @ApiOperation({ summary: '编辑学生' })
  update(
    @CurrentUser() user: AdminUserInfo,
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.service.update(user, id, dto, requestId, ip);
  }

  // ─── Excel 导入 ───

  @Get('admin/import-jobs/template')
  @Permissions(PERM.STUDENT_IMPORT)
  @ApiOperation({ summary: '下载学生导入模板' })
  async template(@Res() res: Response) {
    const buf = await this.service.buildTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.xlsx"');
    res.send(buf);
  }

  @Post('admin/import-jobs')
  @Permissions(PERM.STUDENT_IMPORT)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传 Excel/CSV 并创建导入任务（返回校验预览）' })
  upload(
    @CurrentUser() user: AdminUserInfo,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { campus_id?: string; fee_period_id?: string },
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.service.uploadPreview(user, body?.campus_id, body?.fee_period_id, file, requestId, ip);
  }

  @Get('admin/import-jobs/:id')
  @Permissions(PERM.STUDENT_IMPORT)
  @ApiOperation({ summary: '查看导入任务校验预览' })
  preview(@CurrentUser() user: AdminUserInfo, @Param('id') id: string) {
    return this.service.getPreview(user, id);
  }

  @Post('admin/import-jobs/:id/commit')
  @Permissions(PERM.STUDENT_IMPORT)
  @ApiOperation({ summary: '确认导入（只写入有效行）' })
  commit(
    @CurrentUser() user: AdminUserInfo,
    @Param('id') id: string,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.service.commit(user, id, requestId, ip);
  }

  @Get('admin/import-jobs/:id/errors')
  @Permissions(PERM.STUDENT_IMPORT)
  @ApiOperation({ summary: '下载导入错误报告' })
  async errors(@CurrentUser() user: AdminUserInfo, @Param('id') id: string, @Res() res: Response) {
    const buf = await this.service.buildErrorReport(user, id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="import-errors-${id}.xlsx"`);
    res.send(buf);
  }
}
