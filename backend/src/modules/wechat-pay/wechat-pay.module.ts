import { Module } from '@nestjs/common';
import { WechatPayService } from './wechat-pay.service';
import {
  WechatNotifyController, AdminPaymentController, StudentPaymentController,
} from './wechat-pay.controller';

@Module({
  controllers: [WechatNotifyController, AdminPaymentController, StudentPaymentController],
  providers: [WechatPayService],
  exports: [WechatPayService],
})
export class WechatPayModule {}
