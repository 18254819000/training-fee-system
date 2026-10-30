import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReservationCourseService } from './reservation-course.service';
import { WechatPayService } from '../wechat-pay/wechat-pay.service';
import { PurchaseReservationCourseDto } from './dto/reservation-course.dto';
import { StudentSessionGuard } from '../../common/guards/student-session.guard';
import { ClientIp, CurrentStudentSession, RequestId } from '../../common/decorators/request.decorators';
import { StudentSessionInfo } from '../../common/types';

@ApiTags('学生端-预约课程')
@ApiBearerAuth()
@UseGuards(StudentSessionGuard)
@Controller('me/reservation-courses')
export class StudentReservationController {
  constructor(
    private readonly service: ReservationCourseService,
    private readonly pay: WechatPayService,
  ) {}

  @Get()
  @ApiOperation({ summary: '预约课程列表（登录后：仅自己所在校区）' })
  list(@CurrentStudentSession() session: StudentSessionInfo) {
    return this.service.studentList(session);
  }

  @Post(':id/purchase')
  @ApiOperation({ summary: '购买预约课程：校验到期与校区，创建预约订单并返回 JSAPI 调起参数' })
  purchase(
    @CurrentStudentSession() session: StudentSessionInfo,
    @Param('id') id: string,
    @Body() body: PurchaseReservationCourseDto,
    @Headers('x-idempotency-key') idemKey: string | undefined,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.pay.createCourseOrder(session, id, body?.student_id, idemKey, requestId, ip);
  }
}
