import { Module } from '@nestjs/common';
import { FeePeriodService } from './fee-period.service';
import { FeePeriodController } from './fee-period.controller';

@Module({
  controllers: [FeePeriodController],
  providers: [FeePeriodService],
  exports: [FeePeriodService],
})
export class FeePeriodModule {}
