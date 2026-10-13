import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CourseService } from './course.service';
import {
  CourseQueryDto, CreateCourseDto, CreateFeeItemDto,
  FeeItemQueryDto, SetFeeItemPeriodsDto, UpdateCourseDto, UpdateFeeItemDto,
} from './dto/course.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentUser, RequestId } from '../../common/decorators/request.decorators';
import { AdminUserInfo, PERM } from '../../common/types';

@ApiTags('管理端-课程与收费项目')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller()
export class CourseController {
  constructor(private readonly service: CourseService) {}

  @Get('admin/courses')
  @Permissions(PERM.FEE_ITEM_READ)
  @ApiOperation({ summary: '课程列表' })
  listCourses(@Query() query: CourseQueryDto) {
    return this.service.listCourses(query);
  }

  @Post('admin/courses')
  @Permissions(PERM.FEE_ITEM_WRITE)
  @ApiOperation({ summary: '新建课程' })
  createCourse(
    @CurrentUser() user: AdminUserInfo, @Body() dto: CreateCourseDto,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.createCourse(user, dto, requestId, ip);
  }

  @Patch('admin/courses/:id')
  @Permissions(PERM.FEE_ITEM_WRITE)
  @ApiOperation({ summary: '编辑课程' })
  updateCourse(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string, @Body() dto: UpdateCourseDto,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.updateCourse(user, id, dto, requestId, ip);
  }

  @Get('admin/fee-items')
  @Permissions(PERM.FEE_ITEM_READ)
  @ApiOperation({ summary: '收费项目列表' })
  listFeeItems(@CurrentUser() user: AdminUserInfo, @Query() query: FeeItemQueryDto) {
    return this.service.listFeeItems(user, query);
  }

  @Post('admin/fee-items')
  @Permissions(PERM.FEE_ITEM_WRITE)
  @ApiOperation({ summary: '新增收费项目（直选校区、直接输入价格，可同时绑定收费期）' })
  createFeeItem(
    @CurrentUser() user: AdminUserInfo, @Body() dto: CreateFeeItemDto,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.createFeeItem(user, dto, requestId, ip);
  }

  @Patch('admin/fee-items/:id')
  @Permissions(PERM.FEE_ITEM_WRITE)
  @ApiOperation({ summary: '编辑收费项目' })
  updateFeeItem(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string, @Body() dto: UpdateFeeItemDto,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.updateFeeItem(user, id, dto, requestId, ip);
  }

  @Delete('admin/fee-items/:id')
  @Permissions(PERM.FEE_ITEM_WRITE)
  @ApiOperation({ summary: '删除收费项目（有学生绑定或账单引用时禁止）' })
  deleteFeeItem(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.deleteFeeItem(user, id, requestId, ip);
  }

  @Get('admin/fee-items/:id/periods')
  @Permissions(PERM.FEE_ITEM_READ)
  @ApiOperation({ summary: '查询收费项目已绑定的收费期' })
  getFeeItemPeriods(@Param('id') id: string) {
    return this.service.getFeeItemPeriods(id);
  }

  @Post('admin/fee-items/:id/periods')
  @Permissions(PERM.FEE_ITEM_WRITE)
  @ApiOperation({ summary: '设置收费项目的适用收费期（全量替换，须与项目同校区）' })
  setFeeItemPeriods(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string, @Body() dto: SetFeeItemPeriodsDto,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.setFeeItemPeriods(user, id, dto, requestId, ip);
  }
}
