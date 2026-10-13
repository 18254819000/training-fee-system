import { Module } from '@nestjs/common';
import { RefundService } from './refund.service';
import { RefundController, StudentRefundController } from './refund.controller';
import { WechatPayModule } from '../wechat-pay/wechat-pay.module';

@Module({
  imports: [WechatPayModule],
  controllers: [RefundController, StudentRefundController],
  providers: [RefundService],
  exports: [RefundService],
})
export class RefundModule {}
