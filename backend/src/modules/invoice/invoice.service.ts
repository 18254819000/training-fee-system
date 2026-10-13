import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CampusScopeService } from '../../common/guards/campus-scope.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { CourseService } from '../course/course.service';
import { AdminUserInfo } from '../../common/types';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { GenerateInvoiceDto, InvoiceQueryDto } from './dto/invoice.dto';

// 账单服务：后台生成账单（家长确认缴费模式）
// 铁律：金额全部由服务端按校区价格计算；账单保存项目名称+单价快照；
// 同一学生+收费期+账单类型防重复（数据库唯一键兜底，验收 F-11）
@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly scope: CampusScopeService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly courseService: CourseService,
  ) {}

  async list(user: AdminUserInfo, query: PaginationDto & InvoiceQueryDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: any = {};
    const scopeFilter = this.scope.scopeFilter(user);
    if (query.campus_id) {
      this.scope.assertCampus(user, query.campus_id, '校区');
      where.campus_id = query.campus_id;
    } else if (scopeFilter) {
      where.campus_id = scopeFilter;
    }
    if (query.fee_period_id) where.fee_period_id = query.fee_period_id;
    if (query.student_id) where.student_id = query.student_id;
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = [
        { invoice_no: { contains: query.keyword } },
        { student: { name: { contains: query.keyword } } },
      ];
    }
    const [total, items] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        include: {
          student: { select: { id: true, name: true, student_no: true } },
          campus: { select: { id: true, code: true, name: true } },
          fee_period: { select: { id: true, code: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return paginate(items, total, page, pageSize);
  }

  async get(user: AdminUserInfo, id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        student: true, campus: true, fee_period: true,
        invoice_items: true,
        payment_orders: { orderBy: { created_at: 'desc' }, take: 5 },
      },
    });
    if (!invoice) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '账单不存在' });
    this.scope.assertCampus(user, invoice.campus_id, '账单');
    return invoice;
  }

  /** 生成预览：计算将生成的账单数与总金额（不写库） */
  async preview(user: AdminUserInfo, dto: GenerateInvoiceDto) {
    const { students, period } = await this.resolveTargets(user, dto);
    const lines = await this.buildBillLines(students, period, dto.fee_item_ids);
    const totalFen = lines.reduce((s, l) => s + l.total_fen, 0);
    return {
      preview: true,
      count: lines.length,
      total_fen: totalFen,
      fee_period: { id: period.id, name: period.name },
      items: lines.map((l) => ({
        student_id: l.student.id, student_name: l.student.name,
        campus_id: l.student.campus_id, item_count: l.items.length, total_fen: l.total_fen,
      })),
    };
  }

  /** 批量生成账单（幂等） */
  async generate(user: AdminUserInfo, dto: GenerateInvoiceDto, requestId: string, ip: string) {
    const key = dto.idempotency_key || `invoice-batch:${user.id}:${dto.fee_period_id}:${Date.now()}`;
    return this.idempotency.execute('invoice-batch', key, 3600, async () => {
      const { students, period } = await this.resolveTargets(user, dto);
      const lines = await this.buildBillLines(students, period, dto.fee_item_ids);
      let created = 0;
      const skipped: string[] = [];
      const invoices: Array<{ id: string; invoice_no: string; student_id: string; student_name: string; total_fen: number }> = [];

      await this.prisma.$transaction(async (tx) => {
        for (const line of lines) {
          const invoiceNo = this.genInvoiceNo();
          try {
            const invoice = await tx.invoice.create({
              data: {
                invoice_no: invoiceNo,
                student_id: line.student.id,
                campus_id: line.student.campus_id,
                fee_period_id: period.id,
                amount_due_fen: BigInt(line.total_fen),
                status: 'pending',
                created_by: user.id,
                invoice_items: {
                  create: line.items.map((it) => ({
                    fee_item_id: it.fee_item_id,
                    item_name_snapshot: it.name,
                    unit_price_fen: BigInt(it.unit_price_fen),
                    quantity: it.quantity,
                    line_amount_fen: BigInt(it.line_amount_fen),
                  })),
                },
              },
            });
            created++;
            invoices.push({
              id: invoice.id, invoice_no: invoice.invoice_no,
              student_id: line.student.id, student_name: line.student.name, total_fen: line.total_fen,
            });
          } catch (e: any) {
            // 唯一冲突 = 该学生本期已有主账单 → 跳过并明确提示（验收 F-11）
            if (e?.code === 'P2002') {
              skipped.push(line.student.id);
              continue;
            }
            throw e;
          }
        }
      });

      await this.audit.log({
        actorType: 'admin', actorId: user.id, action: 'invoice.batch_generate', result: 'success',
        requestId, ip,
        metadata: { fee_period_id: period.id, created, skipped_count: skipped.length },
      });
      const totalFen = invoices.reduce((s, i) => s + i.total_fen, 0);
      return {
        preview: false, count: created, total_fen: totalFen,
        skipped_count: skipped.length, skipped_student_ids: skipped, invoices,
      };
    }).then((r) => r.result);
  }

  /** 作废未支付账单（已支付账单走退款流程） */
  async void(user: AdminUserInfo, id: string, reason: string | undefined, requestId: string, ip: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '账单不存在' });
    this.scope.assertCampus(user, invoice.campus_id, '账单');
    if (invoice.status !== 'pending') {
      throw new BadRequestException({ code: 'ERR_INVOICE_STATE', message: '只有待支付账单可以作废' });
    }
    const updated = await this.prisma.invoice.update({ where: { id }, data: { status: 'voided' } });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'invoice.void', resourceType: 'invoice',
      resourceId: id, result: 'success', requestId, ip, metadata: { reason: reason || null },
    });
    return updated;
  }

  // ─── 内部 ───

  /** 解析目标学生集合 + 校验收费期开放 */
  private async resolveTargets(user: AdminUserInfo, dto: GenerateInvoiceDto) {
    const period = await this.prisma.feePeriod.findUnique({
      where: { id: dto.fee_period_id },
      include: { fee_period_campuses: true },
    });
    if (!period) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });
    if (period.status !== 'open') {
      throw new BadRequestException({ code: 'ERR_PERIOD_NOT_OPEN', message: '只有开放中的收费期可以生成账单' });
    }
    const periodCampusIds = period.fee_period_campuses.map((c) => c.campus_id);

    let students: Array<{ id: string; name: string; campus_id: string }>;
    if (dto.student_ids && dto.student_ids.length > 0) {
      if (dto.student_ids.length > 2000) {
        throw new BadRequestException({ code: 'ERR_TOO_MANY', message: '单次生成不超过 2000 名学生' });
      }
      const list = await this.prisma.student.findMany({
        where: { id: { in: dto.student_ids }, status: 'active' },
        select: { id: true, name: true, campus_id: true },
      });
      students = list;
      for (const s of students) {
        this.scope.assertCampus(user, s.campus_id, '学生');
        if (periodCampusIds.length > 0 && !periodCampusIds.includes(s.campus_id)) {
          throw new BadRequestException({ code: 'ERR_PERIOD_CAMPUS', message: `学生 ${s.name} 所在校区不在本收费期适用范围内` });
        }
      }
    } else if (dto.campus_id) {
      this.scope.assertCampus(user, dto.campus_id, '校区');
      if (periodCampusIds.length > 0 && !periodCampusIds.includes(dto.campus_id)) {
        throw new BadRequestException({ code: 'ERR_PERIOD_CAMPUS', message: '该校区不在本收费期适用范围内' });
      }
      students = await this.prisma.student.findMany({
        where: { campus_id: dto.campus_id, status: 'active' },
        select: { id: true, name: true, campus_id: true },
      });
    } else {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '请指定 campus_id 或 student_ids' });
    }
    if (students.length === 0) {
      throw new BadRequestException({ code: 'ERR_NO_STUDENTS', message: '没有符合条件的在读学生' });
    }
    return { students, period };
  }

  /** 为每个学生按校区有效价格组装账单明细（服务端算价） */
  private async buildBillLines(
    students: Array<{ id: string; name: string; campus_id: string }>,
    period: { id: string },
    feeItemIds?: string[],
  ) {
    const byCampus = new Map<string, typeof students>();
    for (const s of students) {
      const arr = byCampus.get(s.campus_id) || [];
      arr.push(s);
      byCampus.set(s.campus_id, arr);
    }
    const lines: Array<{
      student: { id: string; name: string; campus_id: string };
      items: Array<{ fee_item_id: string; name: string; unit_price_fen: number; quantity: number; line_amount_fen: number }>;
      total_fen: number;
    }> = [];
    const today = new Date();
    for (const [campusId, list] of byCampus) {
      let prices = await this.courseService.getEffectivePrices(campusId, today);
      if (feeItemIds && feeItemIds.length > 0) {
        prices = prices.filter((p) => feeItemIds.includes(p.fee_item_id));
      }
      if (prices.length === 0) continue; // 该校区无有效价格：跳过，不生成空账单
      for (const s of list) {
        const items = prices.map((p) => ({
          fee_item_id: p.fee_item_id,
          name: p.fee_item.name,
          unit_price_fen: Number(p.amount_fen),
          quantity: 1,
          line_amount_fen: Number(p.amount_fen),
        }));
        lines.push({ student: s, items, total_fen: items.reduce((sum, it) => sum + it.line_amount_fen, 0) });
      }
    }
    return lines;
  }

  private genInvoiceNo(): string {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `INV${ymd}${this.crypto.randomHex(6).toUpperCase()}`;
  }
}
