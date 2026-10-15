import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StudentSessionInfo } from '../../common/types';

// 学生端门户：登录后的学员/账单查询（全部返回纯数组，前端直接渲染）
// 铁律：只能访问会话绑定的学员数据（session.studentIds 行级隔离）
@Injectable()
export class StudentPortalService {
  constructor(private readonly prisma: PrismaService) {}

  /** Prisma 账单 → 学生端 Invoice DTO（扁平化，前端直接渲染） */
  private toInvoiceDto(inv: any) {
    return {
      id: inv.id,
      invoiceNo: inv.invoice_no,
      studentId: inv.student_id,
      studentName: inv.student?.name,
      campusId: inv.campus_id,
      campusName: inv.campus?.name,
      campusContactPhone: inv.campus?.contact_phone,
      feePeriodId: inv.fee_period_id,
      feePeriodName: inv.fee_period?.name,
      items: (inv.invoice_items || []).map((it: any) => ({
        feeItemId: it.fee_item_id,
        itemNameSnapshot: it.item_name_snapshot,
        unitPriceFen: Number(it.unit_price_fen),
        quantity: it.quantity,
        lineAmountFen: Number(it.line_amount_fen),
      })),
      amountDueFen: Number(inv.amount_due_fen),
      amountPaidFen: Number(inv.amount_paid_fen),
      amountRefundedFen: Number(inv.amount_refunded_fen || 0),
      status: inv.status,
      createdAt: inv.created_at,
      updatedAt: inv.updated_at,
    };
  }

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
    const list = await this.prisma.invoice.findMany({
      where,
      include: {
        student: { select: { id: true, name: true } },
        campus: { select: { id: true, name: true, contact_phone: true } },
        fee_period: { select: { id: true, name: true, start_date: true, end_date: true } },
        invoice_items: true,
      },
      orderBy: { created_at: 'desc' },
    });
    return list.map((inv) => this.toInvoiceDto(inv));
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
    return this.toInvoiceDto(invoice);
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

  /** 课程列表（按校区编码，用于小程序首页展示） */
  async coursesByCampus(campusCode: string) {
    if (!campusCode) return [];
    const campus = await this.prisma.campus.findUnique({ where: { code: campusCode } });
    if (!campus) return [];
    const items = await this.prisma.feeItem.findMany({
      where: { campus_id: campus.id, status: 'active' },
      select: { id: true, name: true, description: true, amount_fen: true },
      orderBy: { created_at: 'asc' },
    });
    return items.map((it) => ({
      id: it.id,
      name: it.name,
      description: it.description,
      amountFen: Number(it.amount_fen),
    }));
  }
}
