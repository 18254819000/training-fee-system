import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CourseService } from './course.service';
import {
  CloseCampusPriceDto, CreateCampusPriceDto, CreateCourseDto, CreateFeeItemDto,
  UpdateCourseDto, UpdateFeeItemDto,
} from './dto/course.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentUser, RequestId } from '../../common/decorators/request.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
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
  listCourses(@Query() query: PaginationDto & { status?: string; keyword?: string }) {
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
  listFeeItems(@Query() query: PaginationDto & { status?: string; keyword?: string; course_id?: string }) {
    return this.service.listFeeItems(query);
  }

  @Post('admin/fee-items')
  @Permissions(PERM.FEE_ITEM_WRITE)
  @ApiOperation({ summary: '新增收费项目' })
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

  @Get('admin/campus-fee-prices')
  @Permissions(PERM.FEE_ITEM_READ)
  @ApiOperation({ summary: '校区价格列表' })
  listCampusPrices(
    @CurrentUser() user: AdminUserInfo,
    @Query() query: PaginationDto & { fee_item_id?: string; campus_id?: string },
  ) {
    return this.service.listCampusPrices(user, query);
  }

  @Post('admin/campus-fee-prices')
  @Permissions(PERM.FEE_ITEM_WRITE)
  @ApiOperation({ summary: '新增校区价格（有效期不可重叠）' })
  createCampusPrice(
    @CurrentUser() user: AdminUserInfo, @Body() dto: CreateCampusPriceDto,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.createCampusPrice(user, dto, requestId, ip);
  }

  @Patch('admin/campus-fee-prices/:id/close')
  @Permissions(PERM.FEE_ITEM_WRITE)
  @ApiOperation({ summary: '关闭价格（设失效日期，不物理删除）' })
  closeCampusPrice(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string, @Body() dto: CloseCampusPriceDto,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.closeCampusPrice(user, id, dto, requestId, ip);
  }
}
