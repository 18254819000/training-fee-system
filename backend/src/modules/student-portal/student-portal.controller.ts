import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StudentPortalService } from './student-portal.service';
import { StudentSessionGuard } from '../../common/guards/student-session.guard';
import { CurrentStudentSession } from '../../common/decorators/request.decorators';
import { StudentSessionInfo } from '../../common/types';

@ApiTags('学生端-门户')
@UseGuards(StudentSessionGuard)
@Controller('me')
export class StudentPortalController {
  constructor(private readonly service: StudentPortalService) {}

  @Get('students')
  @ApiOperation({ summary: '我绑定的学员列表' })
  myStudents(@CurrentStudentSession() student: StudentSessionInfo) {
    return this.service.myStudents(student);
  }

  @Get('fee-periods')
  @ApiOperation({ summary: '可见收费期' })
  myFeePeriods(
    @CurrentStudentSession() student: StudentSessionInfo,
    @Query('student_id') studentId?: string,
  ) {
    return this.service.myFeePeriods(student, studentId);
  }

  @Get('invoices')
  @ApiOperation({ summary: '我的账单列表' })
  myInvoices(
    @CurrentStudentSession() student: StudentSessionInfo,
    @Query() query: { student_id?: string; fee_period_id?: string },
  ) {
    return this.service.myInvoices(student, query);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: '账单详情' })
  invoiceDetail(@CurrentStudentSession() student: StudentSessionInfo, @Param('id') id: string) {
    return this.service.invoiceDetail(student, id);
  }

  @Get('payment-history')
  @ApiOperation({ summary: '我的支付历史' })
  myPaymentHistory(@CurrentStudentSession() student: StudentSessionInfo) {
    return this.service.myPaymentHistory(student);
  }
}
