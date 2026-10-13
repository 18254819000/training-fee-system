import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags} from '@nestjs/swagger';
import { Request} from 'express';
import { WechatPayService} from './wechat-pay.service';
import { AdminJwtGuard} from '../../common/guards/admin-jwt.guard';
import { RolesGuard} from '../../common/guards/roles.guard';
import { StudentSessionGuard} from '../../common/guards/student-session.guard';
import { Permissions} from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentStudentSession, CurrentUser, RequestId} from '../../common/decorators/request.decorators';
import { PaginationDto} from '../../common/dto/pagination.dto';
import { AdminUserInfo, PERM, StudentSessionInfo} from '../../common/types';

// 微信支付：支付通知/退款通知为公开端点（走签名验签，不走登录）
@ApiTags('微信支付通知')
@Controller('wechat')
export class WechatNotifyController {
constructor(private readonly service: WechatPayService) {}

@Post('notify')
@HttpCode(200)
@ApiExcludeEndpoint()
async notify(@Headers() headers: Record<string, string>, @Req() req: Request, @RequestId() requestId: string) {
const rawBody: Buffer = (req as any).rawBody || Buffer.from(JSON.stringify(req.body || {}));
return this.service.handleNotify(headers, rawBody, requestId);
}

@Post('refund-notify')
@HttpCode(200)
@ApiExcludeEndpoint()
async refundNotify(@Headers() headers: Record<string, string>, @Req() req: Request, @RequestId() requestId: string) {
const rawBody: Buffer = (req as any).rawBody || Buffer.from(JSON.stringify(req.body || {}));
return this.service.handleRefundNotify(headers, rawBody, requestId);
}
}

@ApiTags('管理端-支付订单')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller('admin/payment-orders')
export class AdminPaymentController {
constructor(private readonly service: WechatPayService) {}

@Get()
@Permissions(PERM.PAYMENT_READ)
@ApiOperation({ summary: '支付订单列表'})
list(@CurrentUser() user: AdminUserInfo, @Query() query: PaginationDto & Record<string, any>) {
return this.service.adminList(user, query);
}

@Get(':id')
@Permissions(PERM.PAYMENT_READ)
@ApiOperation({ summary: '支付订单详情'})
get(@CurrentUser() user: AdminUserInfo, @Param('id') id: string) {
return this.service.adminGet(id, user);
}

@Post(':id/reconcile')
@Permissions(PERM.PAYMENT_RECONCILE)
@ApiOperation({ summary: '查单：向微信查询订单状态并补入账（受控操作）'})
reconcile(
@CurrentUser() user: AdminUserInfo, @Param('id') id: string,
@RequestId() requestId: string,
) {
return this.service.reconcile(id, user, requestId);
}

@Post(':id/simulate-paid')
@Permissions(PERM.PAYMENT_RECONCILE)
@ApiOperation({ summary: '模拟微信支付成功（联调测试，非生产环境）'})
simulatePaid(
@CurrentUser() user: AdminUserInfo, @Param('id') id: string,
@RequestId() requestId: string,
) {
return this.service.simulatePaid(id, user, requestId);
}
}

@ApiTags('学生端-支付')
@UseGuards(StudentSessionGuard)
@Controller('me/payments')
export class StudentPaymentController {
constructor(private readonly service: WechatPayService) {}

@Get()
@ApiOperation({ summary: '我的支付订单列表'})
list(@CurrentStudentSession() student: StudentSessionInfo) {
return this.service.studentListOrders(student);
}

@Get(':id')
@ApiOperation({ summary: '支付订单详情'})
get(@CurrentStudentSession() student: StudentSessionInfo, @Param('id') id: string) {
return this.service.studentGetOrder(student, id);
}

@Post()
@ApiOperation({ summary: '为账单创建支付订单并返回 JSAPI 调起参数'})
create(
@CurrentStudentSession() student: StudentSessionInfo,
@Body() body: { invoice_id: string},
@Headers('x-idempotency-key') idemKey: string | undefined,
@RequestId() requestId: string,
@ClientIp() ip: string,
) {
return this.service.createOrder(student, body?.invoice_id, idemKey, requestId, ip);
}
}
