import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { ErrorLogStore } from '../../common/error-log/error-log.store';

@Module({
  controllers: [SystemController],
  providers: [ErrorLogStore],
  exports: [ErrorLogStore],
})
export class SystemModule {}
