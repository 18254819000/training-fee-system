import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CampusService } from './campus.service';
import { CreateCampusDto, UpdateCampusDto } from './dto/campus.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentUser, RequestId } from '../../common/decorators/request.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AdminUserInfo, PERM } from '../../common/types';

@ApiTags('管理端-校区')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller('admin/campuses')
export class CampusController {
  constructor(private readonly campus: CampusService) {}

  @Get()
  @Permissions(PERM.CAMPUS_READ)
  @ApiOperation({ summary: '校区列表' })
  list(@CurrentUser() user: AdminUserInfo, @Query() query: PaginationDto) {
    return this.campus.list(user, query);
  }

  @Post()
  @Permissions(PERM.CAMPUS_WRITE)
  @ApiOperation({ summary: '新建校区' })
  create(
    @CurrentUser() user: AdminUserInfo,
    @Body() dto: CreateCampusDto,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.campus.create(user, dto, requestId, ip);
  }

  @Get(':id')
  @Permissions(PERM.CAMPUS_READ)
  @ApiOperation({ summary: '校区详情' })
  get(@CurrentUser() user: AdminUserInfo, @Param('id') id: string) {
    return this.campus.get(user, id);
  }

  @Patch(':id')
  @Permissions(PERM.CAMPUS_WRITE)
  @ApiOperation({ summary: '编辑/停用校区（无物理删除）' })
  update(
    @CurrentUser() user: AdminUserInfo,
    @Param('id') id: string,
    @Body() dto: UpdateCampusDto,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.campus.update(user, id, dto, requestId, ip);
  }
}
