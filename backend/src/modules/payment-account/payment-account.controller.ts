import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentAccountService } from './payment-account.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentUser, RequestId } from '../../common/decorators/request.decorators';
import { AdminUserInfo, PERM } from '../../common/types';

@ApiTags('管理端-支付账户')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller('admin/payment-accounts')
export class PaymentAccountController {
  constructor(private readonly service: PaymentAccountService) {}

  @Get()
  @Permissions(PERM.PAYMENT_ACCOUNT_READ)
  @ApiOperation({ summary: '支付账户列表（脱敏）' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @Permissions(PERM.PAYMENT_ACCOUNT_READ)
  @ApiOperation({ summary: '支付账户详情（脱敏）' })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @Permissions(PERM.PAYMENT_ACCOUNT_MANAGE)
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'privateKeyFile', maxCount: 1 },
    { name: 'certFile', maxCount: 1 },
  ], { storage: memoryStorage(), limits: { fileSize: 64 * 1024 } }))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: '创建支付账户（草稿）；私钥走 privateKeyFile，证书走 certFile（自动提取序列号），APIv3/平台公钥走文本字段，仅存加密引用' })
  create(
    @CurrentUser() user: AdminUserInfo,
    @Body() body: Record<string, any>,
    @UploadedFiles() files: { privateKeyFile?: Express.Multer.File[]; certFile?: Express.Multer.File[] },
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.service.create(user, body, files?.privateKeyFile?.[0], files?.certFile?.[0], requestId, ip);
  }

  @Patch(':id')
  @Permissions(PERM.PAYMENT_ACCOUNT_MANAGE)
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'privateKeyFile', maxCount: 1 },
    { name: 'certFile', maxCount: 1 },
  ], { storage: memoryStorage(), limits: { fileSize: 64 * 1024 } }))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: '更新支付账户；密钥字段留空表示不修改；关键字段变更会使启用中账户回退为草稿' })
  update(
    @CurrentUser() user: AdminUserInfo,
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @UploadedFiles() files: { privateKeyFile?: Express.Multer.File[]; certFile?: Express.Multer.File[] },
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.service.update(user, id, body, files?.privateKeyFile?.[0], files?.certFile?.[0], requestId, ip);
  }

  @Post(':id/validate')
  @Permissions(PERM.PAYMENT_ACCOUNT_MANAGE)
  @ApiOperation({ summary: '自检：校验配置完整性与密钥可解析性（启用前必须通过）' })
  validate(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.validate(user, id, requestId, ip);
  }

  @Post(':id/activate')
  @Permissions(PERM.PAYMENT_ACCOUNT_MANAGE)
  @ApiOperation({ summary: '启用支付账户（需先通过自检）' })
  activate(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.activate(user, id, requestId, ip);
  }

  @Post(':id/disable')
  @Permissions(PERM.PAYMENT_ACCOUNT_MANAGE)
  @ApiOperation({ summary: '停用支付账户' })
  disable(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.disable(user, id, requestId, ip);
  }

  @Delete(':id')
  @Permissions(PERM.PAYMENT_ACCOUNT_MANAGE)
  @ApiOperation({ summary: '删除支付账户（仅草稿/测试/停用且无订单时）' })
  remove(
    @CurrentUser() user: AdminUserInfo, @Param('id') id: string,
    @RequestId() requestId: string, @ClientIp() ip: string,
  ) {
    return this.service.remove(user, id, requestId, ip);
  }
}
