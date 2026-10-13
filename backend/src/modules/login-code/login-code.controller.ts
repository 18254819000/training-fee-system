import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LoginCodeService } from './login-code.service';
import { BatchIssueDto, LoginCodeQueryDto } from './dto/login-code.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentUser, RequestId } from '../../common/decorators/request.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AdminUserInfo, PERM } from '../../common/types';

@ApiTags('管理端-登录码')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller('admin/login-codes')
export class LoginCodeController {
  constructor(private readonly service: LoginCodeService) {}

  @Get()
  @Permissions(PERM.LOGIN_CODE_MANAGE)
  @ApiOperation({ summary: '登录码状态查询（不返回明文）' })
  list(@CurrentUser() user: AdminUserInfo, @Query() query: PaginationDto & LoginCodeQueryDto) {
    return this.service.list(user, query);
  }

  @Post('batch')
  @Permissions(PERM.LOGIN_CODE_MANAGE)
  @ApiOperation({ summary: '批量签发登录码（明文仅返回一次）' })
  batchIssue(
    @CurrentUser() user: AdminUserInfo,
    @Body() dto: BatchIssueDto,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.service.batchIssue(user, dto, requestId, ip);
  }

  @Post(':id/revoke')
  @Permissions(PERM.LOGIN_CODE_MANAGE)
  @ApiOperation({ summary: '撤销登录码' })
  revoke(
    @CurrentUser() user: AdminUserInfo,
    @Param('id') id: string,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.service.revoke(user, id, requestId, ip);
  }
}
