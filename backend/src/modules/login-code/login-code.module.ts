import { Module } from '@nestjs/common';
import { LoginCodeService } from './login-code.service';
import { LoginCodeController } from './login-code.controller';

@Module({
  controllers: [LoginCodeController],
  providers: [LoginCodeService],
  exports: [LoginCodeService],
})
export class LoginCodeModule {}
