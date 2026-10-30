import { Module } from '@nestjs/common';
import { ReservationCourseService } from './reservation-course.service';
import { ReservationCourseController } from './reservation-course.controller';
import { PublicReservationController } from './public-reservation.controller';
import { StudentReservationController } from './student-reservation.controller';
import { WechatPayModule } from '../wechat-pay/wechat-pay.module';

@Module({
  imports: [WechatPayModule],
  controllers: [ReservationCourseController, PublicReservationController, StudentReservationController],
  providers: [ReservationCourseService],
  exports: [ReservationCourseService],
})
export class ReservationCourseModule {}
