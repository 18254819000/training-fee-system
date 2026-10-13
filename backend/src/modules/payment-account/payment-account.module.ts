import { Module } from '@nestjs/common';
import { PaymentAccountService } from './payment-account.service';
import { PaymentAccountController } from './payment-account.controller';

@Module({
  controllers: [PaymentAccountController],
  providers: [PaymentAccountService],
  exports: [PaymentAccountService],
})
export class PaymentAccountModule {}
