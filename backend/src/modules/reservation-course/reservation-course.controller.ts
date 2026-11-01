import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReservationCourseService } from './reservation-course.service';
import {
  CreateReservationCourseDto, ReservationCourseQueryDto, ReservationOrderQueryDto, UpdateReservationCourseDto,
} from './dto/reservation-course.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentUser, RequestId } from '../../common/decorators/request.decorators';
import { AdminUserInfo, PERM } from '../../common/types';

@ApiTags('管理端-预约课程')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller()
export class ReservationCourseController {
  constructor(private readonly service: ReservationCourseService) {}

  @Get('admin/reservation-courses')
  @Permissions(PERM.FEE_ITEM_READ)
  @ApiOperation({ summary: '预约课程列表（管理端）' })
  list(@CurrentUser() user: AdminUserInfo, @Query() query: ReservationCourseQueryDto) {
    return this.service.list(user, query);
  }

  @Post('admin/reservation-courses')
  @Permissions(PERM.FEE_ITEM_WRITE)
  @ApiOperation({ summary: '新建预约课程（名称/详情/价格/截止日期）' })
  create(
    @CurrentUser() user: AdminUserInfo, @Body() dto: CreateReservationCourseDto,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.create(user, dto, requestId, ip);
  }

  @Patch('admin/reservation-courses/:id')
  @Permissions(PERM.FEE_ITEM_WRITE)
  @ApiOperation({ summary: '编辑预约课程' })
  update(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string, @Body() dto: UpdateReservationCourseDto,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.update(user, id, dto, requestId, ip);
  }

  @Delete('admin/reservation-courses/:id')
  @Permissions(PERM.FEE_ITEM_WRITE)
  @ApiOperation({ summary: '删除预约课程（已有订单时禁止）' })
  remove(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.remove(user, id, requestId, ip);
  }

  @Get('admin/reservation-orders')
  @Permissions(PERM.FEE_ITEM_READ)
  @ApiOperation({ summary: '预约订单列表（管理端；独立于账单）' })
  orderList(@CurrentUser() user: AdminUserInfo, @Query() query: ReservationOrderQueryDto) {
    return this.service.adminOrderList(user, query);
  }

  @Get('admin/reservation-orders/stats')
  @Permissions(PERM.FEE_ITEM_READ)
  @ApiOperation({ summary: '预约订单统计（管理端；独立于账单）' })
  orderStats(@CurrentUser() user: AdminUserInfo, @Query('campus_id') campusId?: string) {
    return this.service.adminOrderStats(user, campusId);
  }
}
