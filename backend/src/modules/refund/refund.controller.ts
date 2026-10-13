import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags} from '@nestjs/swagger';
import { RefundService} from './refund.service';
import { AdminJwtGuard} from '../../common/guards/admin-jwt.guard';
import { RolesGuard} from '../../common/guards/roles.guard';
import { StudentSessionGuard} from '../../common/guards/student-session.guard';
import { Permissions} from '../../common/decorators/auth.decorators';
import { ClientIp, CurrentStudentSession, CurrentUser, RequestId} from '../../common/decorators/request.decorators';
import { PaginationDto} from '../../common/dto/pagination.dto';
import { AdminUserInfo, PERM, StudentSessionInfo} from '../../common/types';

@ApiTags('管理端-退款')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard, RolesGuard)
@Controller('admin/refunds')
export class RefundController {
constructor(private readonly service: RefundService) {}

@Get()
@Permissions(PERM.REFUND_APPLY)
@ApiOperation({ summary: '退款单列表'})
list(@CurrentUser() user: AdminUserInfo, @Query() query: PaginationDto & Record<string, any>) {
return this.service.list(user, query);
}

@Post()
@Permissions(PERM.REFUND_APPLY)
@ApiOperation({ summary: '申请退款（一期仅支持全额退款，同一订单防重）'})
apply(
@CurrentUser() user: AdminUserInfo,
@Body() body: { payment_order_id: string; reason: string; amount_fen?: number},
@Headers('x-idempotency-key') idemKey: string | undefined,
@RequestId() requestId: string,
@ClientIp() ip: string,
) {
return this.service.apply(user, body?.payment_order_id, body?.reason, body?.amount_fen, idemKey, requestId, ip);
}

@Get(':id')
@Permissions(PERM.REFUND_APPLY)
@ApiOperation({ summary: '退款单详情'})
get(@CurrentUser() user: AdminUserInfo, @Param('id') id: string) {
return this.service.get(user, id);
}

@Post(':id/submit')
@Permissions(PERM.REFUND_SUBMIT)
@ApiOperation({ summary: '提交退款到微信'})
submit(
@CurrentUser() user: AdminUserInfo, @Param('id') id: string,
@RequestId() requestId: string, @ClientIp() ip: string,
) {
return this.service.submit(user, id, requestId, ip);
}

@Post(':id/sync')
@Permissions(PERM.REFUND_SUBMIT)
@ApiOperation({ summary: '同步退款状态（向微信查单）'})
sync(
@CurrentUser() user: AdminUserInfo, @Param('id') id: string,
@RequestId() requestId: string,
) {
return this.service.sync(user, id, requestId);
}

@Post(':id/simulate-success')
@Permissions(PERM.REFUND_SUBMIT)
@ApiOperation({ summary: '模拟微信退款成功（联调测试，非生产环境）'})
simulateSuccess(
@CurrentUser() user: AdminUserInfo, @Param('id') id: string,
@RequestId() requestId: string,
) {
return this.service.simulateSuccess(id, user, requestId);
}
}

@ApiTags('学生端-退款')
@UseGuards(StudentSessionGuard)
@Controller('me/refunds')
export class StudentRefundController {
constructor(private readonly service: RefundService) {}

@Get()
@ApiOperation({ summary: '我的退款记录'})
list(@CurrentStudentSession() student: StudentSessionInfo) {
return this.service.studentList(student);
}
}
