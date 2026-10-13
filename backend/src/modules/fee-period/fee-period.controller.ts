import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FeePeriodService } from './fee-period.service';
import { CreateFeePeriodDto, UpdateFeePeriodDto } from './dto/fee-period.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentUser, RequestId } from '../../common/decorators/request.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AdminUserInfo, PERM } from '../../common/types';

@ApiTags('管理端-收费期')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller('admin/fee-periods')
export class FeePeriodController {
  constructor(private readonly service: FeePeriodService) {}

  @Get()
  @Permissions(PERM.FEE_PERIOD_READ)
  @ApiOperation({ summary: '收费期列表' })
  list(@CurrentUser() user: AdminUserInfo, @Query() query: PaginationDto) {
    return this.service.list(user, query);
  }

  @Post()
  @Permissions(PERM.FEE_PERIOD_WRITE)
  @ApiOperation({ summary: '新建收费期' })
  create(
    @CurrentUser() user: AdminUserInfo,
    @Body() dto: CreateFeePeriodDto,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.service.create(user, dto, requestId, ip);
  }

  @Get(':id')
  @Permissions(PERM.FEE_PERIOD_READ)
  @ApiOperation({ summary: '收费期详情' })
  get(@CurrentUser() user: AdminUserInfo, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Patch(':id')
  @Permissions(PERM.FEE_PERIOD_WRITE)
  @ApiOperation({ summary: '编辑收费期（含开放/结束状态流转）' })
  update(
    @CurrentUser() user: AdminUserInfo,
    @Param('id') id: string,
    @Body() dto: UpdateFeePeriodDto,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.service.update(user, id, dto, requestId, ip);
  }
}
