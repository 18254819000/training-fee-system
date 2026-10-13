import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvoiceService } from './invoice.service';
import { GenerateInvoiceDto, InvoiceQueryDto, VoidInvoiceDto } from './dto/invoice.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentUser, RequestId } from '../../common/decorators/request.decorators';
import { AdminUserInfo, PERM } from '../../common/types';

@ApiTags('管理端-账单')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller('admin/invoices')
export class InvoiceController {
  constructor(private readonly service: InvoiceService) {}

  @Get()
  @Permissions(PERM.INVOICE_READ)
  @ApiOperation({ summary: '账单列表' })
  list(@CurrentUser() user: AdminUserInfo, @Query() query: InvoiceQueryDto) {
    return this.service.list(user, query);
  }

  @Post()
  @Permissions(PERM.INVOICE_GENERATE)
  @ApiOperation({ summary: '批量生成账单（preview=true 时仅预览不写库）' })
  generate(
    @CurrentUser() user: AdminUserInfo,
    @Body() dto: GenerateInvoiceDto,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    if (dto.preview) return this.service.preview(user, dto);
    return this.service.generate(user, dto, requestId, ip);
  }

  @Get(':id')
  @Permissions(PERM.INVOICE_READ)
  @ApiOperation({ summary: '账单详情（含明细快照与支付订单）' })
  get(@CurrentUser() user: AdminUserInfo, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Post(':id/void')
  @Permissions(PERM.INVOICE_VOID)
  @ApiOperation({ summary: '作废未支付账单' })
  void(
    @CurrentUser() user: AdminUserInfo,
    @Param('id') id: string,
    @Body() dto: VoidInvoiceDto,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.service.void(user, id, dto?.reason, requestId, ip);
  }
}
