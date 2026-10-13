import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StudentSessionInfo } from '../../common/types';

// 学生端门户：登录后的学员/账单查询（全部返回纯数组，前端直接渲染）
// 铁律：只能访问会话绑定的学员数据（session.studentIds 行级隔离）
@Injectable()
export class StudentPortalService {
  constructor(private readonly prisma: PrismaService) {}

  private assertStudent(session: StudentSessionInfo, studentId: string | undefined) {
    if (studentId && !session.studentIds.includes(studentId)) {
      throw new ForbiddenException({ code: 'ERR_FORBIDDEN', message: '无权访问该学员' });
    }
  }

  /** 我绑定的学员列表 */
  async myStudents(session: StudentSessionInfo) {
    return this.prisma.student.findMany({
      where: { id: { in: session.studentIds } },
      include: { campus: { select: { id: true, name: true } } },
      orderBy: { created_at: 'asc' },
    });
  }

  /** 可见的收费期（学员所在校区的有效收费期） */
  async myFeePeriods(session: StudentSessionInfo, studentId?: string) {
    this.assertStudent(session, studentId);
    const students = await this.prisma.student.findMany({
      where: { id: { in: studentId ? [studentId] : session.studentIds } },
      select: { campus_id: true },
    });
    const campusIds = [...new Set(students.map((s) => s.campus_id))];
    return this.prisma.feePeriod.findMany({
      where: {
        status: { in: ['open', 'closed'] },
        campus_id: { in: campusIds },
      },
      include: {
        campus: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /** 我的账单列表（纯数组） */
  async myInvoices(session: StudentSessionInfo, query: { student_id?: string; fee_period_id?: string }) {
    const studentId = query.student_id;
    this.assertStudent(session, studentId);
    const where: any = { student_id: { in: studentId ? [studentId] : session.studentIds } };
    if (query.fee_period_id) where.fee_period_id = query.fee_period_id;
    return this.prisma.invoice.findMany({
      where,
      include: {
        fee_period: { select: { id: true, name: true, start_date: true, end_date: true } },
        invoice_items: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /** 账单详情（含明细快照） */
  async invoiceDetail(session: StudentSessionInfo, id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        student: { select: { id: true, name: true } },
        campus: { select: { id: true, name: true } },
        fee_period: true,
        invoice_items: true,
        payment_orders: { orderBy: { created_at: 'desc' }, take: 5 },
      },
    });
    if (!invoice || !session.studentIds.includes(invoice.student_id)) {
      throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '账单不存在' });
    }
    return invoice;
  }

  /** 我的支付历史（纯数组） */
  async myPaymentHistory(session: StudentSessionInfo) {
    return this.prisma.paymentOrder.findMany({
      where: { invoice: { student_id: { in: session.studentIds } } },
      include: {
        invoice: { select: { id: true, invoice_no: true, fee_period: { select: { name: true } } } },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
  }
}
