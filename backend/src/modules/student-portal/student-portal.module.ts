import { Module } from '@nestjs/common';
import { StudentPortalService } from './student-portal.service';
import { StudentPortalController } from './student-portal.controller';

@Module({
  controllers: [StudentPortalController],
  providers: [StudentPortalService],
  exports: [StudentPortalService],
})
export class StudentPortalModule {}
