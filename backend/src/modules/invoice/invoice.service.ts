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
// 新模型：收费期绑定收费项目 → 学生绑定收费项目 → 一键生成本期全部学生账单（预览确认）
// 铁律：金额全部由服务端按校区价格计算；账单保存项目名称+单价快照；
// 同一学生+收费期+账单类型防重复（预查排除已有账单 + 数据库唯一键兜底，验收 F-11）
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

  async list(user: AdminUserInfo, query: InvoiceQueryDto) {
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
    const { students, period, feeItemMap } = await this.resolveTargets(user, dto);
    const { lines, skipped } = await this.buildBillLines(students, feeItemMap);
    const totalFen = lines.reduce((s, l) => s + l.total_fen, 0);
    return {
      preview: true,
      count: lines.length,
      total_fen: totalFen,
      fee_period: { id: period.id, name: period.name },
      students: lines.map((l) => ({
        student_id: l.student.id,
        student_name: l.student.name,
        campus_id: l.student.campus_id,
        fee_item_id: l.feeItem.id,
        fee_item_name: l.feeItem.name,
        amount_fen: l.total_fen,
      })),
      skipped: skipped.map((s) => ({
        student_id: s.student.id, student_name: s.student.name, reason: s.reason,
      })),
    };
  }

  /** 批量生成账单（幂等）：每个学生按其绑定的收费项目生成 */
  async generate(user: AdminUserInfo, dto: GenerateInvoiceDto, requestId: string, ip: string) {
    const key = dto.idempotency_key || `invoice-batch:${user.id}:${dto.fee_period_id}:${Date.now()}`;
    return this.idempotency.execute('invoice-batch', key, 3600, async () => {
      const { students, period, feeItemMap } = await this.resolveTargets(user, dto);
      const { lines, skipped } = await this.buildBillLines(students, feeItemMap);
      let created = 0;
      const skippedAll: Array<{ student_id: string; student_name: string; reason: string }> = [
        ...skipped.map((s) => ({ student_id: s.student.id, student_name: s.student.name, reason: s.reason })),
      ];
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
            // 唯一冲突 = 该学生本期已有主账单（并发兜底）→ 跳过并明确提示（验收 F-11）
            if (e?.code === 'P2002') {
              skippedAll.push({ student_id: line.student.id, student_name: line.student.name, reason: '本期已有账单' });
              continue;
            }
            throw e;
          }
        }
      });

      await this.audit.log({
        actorType: 'admin', actorId: user.id, action: 'invoice.batch_generate', result: 'success',
        requestId, ip,
        metadata: { fee_period_id: period.id, created, skipped_count: skippedAll.length },
      });
      const totalFen = invoices.reduce((s, i) => s + i.total_fen, 0);
      return {
        preview: false, count: created, total_fen: totalFen,
        skipped_count: skippedAll.length,
        skipped: skippedAll,
        skipped_student_ids: skippedAll.map((s) => s.student_id),
        invoices,
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

  /**
   * 解析目标学生集合 + 校验收费期开放。
   * 新模型：收费期绑定收费项目 → 学生绑定收费项目 → 一键生成本期全部学生账单。
   * 返回：在读、校区在范围内、本期尚无账单的学生，以及本期启用的收费项目。
   */
  private async resolveTargets(user: AdminUserInfo, dto: GenerateInvoiceDto) {
    const period = await this.prisma.feePeriod.findUnique({
      where: { id: dto.fee_period_id },
      include: {
        fee_period_campuses: true,
        fee_item_periods: { include: { fee_item: true } },
      },
    });
    if (!period) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });
    if (period.status !== 'open') {
      throw new BadRequestException({ code: 'ERR_PERIOD_NOT_OPEN', message: '只有开放中的收费期可以生成账单' });
    }
    const periodCampusIds = period.fee_period_campuses.map((c) => c.campus_id);

    // 本期绑定的收费项目（只取启用中的；可再用 fee_item_ids 缩小范围）
    let feeItems = period.fee_item_periods
      .map((fp) => fp.fee_item)
      .filter((fi) => fi.status === 'active');
    if (dto.fee_item_ids && dto.fee_item_ids.length > 0) {
      const wanted = new Set(dto.fee_item_ids);
      feeItems = feeItems.filter((fi) => wanted.has(fi.id));
    }
    if (feeItems.length === 0) {
      throw new BadRequestException({ code: 'ERR_NO_FEE_ITEMS', message: '该收费期未绑定任何启用的收费项目' });
    }
    const feeItemMap = new Map(feeItems.map((fi) => [fi.id, fi]));
    const periodFeeItemIds = feeItems.map((fi) => fi.id);

    // 校区范围：显式 campus_id > 收费期适用校区 > 管理员校区权限
    let campusIds: string[];
    if (dto.campus_id) {
      this.scope.assertCampus(user, dto.campus_id, '校区');
      if (periodCampusIds.length > 0 && !periodCampusIds.includes(dto.campus_id)) {
        throw new BadRequestException({ code: 'ERR_PERIOD_CAMPUS', message: '该校区不在本收费期适用范围内' });
      }
      campusIds = [dto.campus_id];
    } else if (periodCampusIds.length > 0) {
      for (const cid of periodCampusIds) this.scope.assertCampus(user, cid, '校区');
      campusIds = periodCampusIds;
    } else {
      const sf = this.scope.scopeFilter(user);
      campusIds = sf ? sf.in : [];
    }

    // 目标学生：在读（可选 student_ids 缩小范围）
    const studentWhere: any = { status: 'active' };
    if (campusIds.length > 0) studentWhere.campus_id = { in: campusIds };
    if (dto.student_ids && dto.student_ids.length > 0) {
      if (dto.student_ids.length > 2000) {
        throw new BadRequestException({ code: 'ERR_TOO_MANY', message: '单次生成不超过 2000 名学生' });
      }
      studentWhere.id = { in: dto.student_ids };
    }
    const allStudents = await this.prisma.student.findMany({
      where: studentWhere,
      select: { id: true, name: true, campus_id: true, fee_item_id: true },
    });
    for (const s of allStudents) {
      this.scope.assertCampus(user, s.campus_id, '学生');
      if (periodCampusIds.length > 0 && !periodCampusIds.includes(s.campus_id)) {
        throw new BadRequestException({ code: 'ERR_PERIOD_CAMPUS', message: `学生 ${s.name} 所在校区不在本收费期适用范围内` });
      }
    }

    // 幂等：排除本期已有账单的学生
    const existing = allStudents.length > 0
      ? await this.prisma.invoice.findMany({
        where: { fee_period_id: period.id, student_id: { in: allStudents.map((s) => s.id) } },
        select: { student_id: true },
      })
      : [];
    const existingSet = new Set(existing.map((e) => e.student_id));
    const students = allStudents.filter((s) => !existingSet.has(s.id));
    return { students, period, feeItems, feeItemMap, periodFeeItemIds };
  }

  /**
   * 为每个学生按其绑定的收费项目组装账单明细（服务端算价）。
   * 无绑定 / 绑定项目不在本期 / 无有效价格 → 记入 skipped 并给出原因，不生成空账单。
   */
  private async buildBillLines(
    students: Array<{ id: string; name: string; campus_id: string; fee_item_id: string | null }>,
    feeItemMap: Map<string, { id: string; name: string }>,
  ) {
    type Line = {
      student: { id: string; name: string; campus_id: string };
      feeItem: { id: string; name: string };
      items: Array<{ fee_item_id: string; name: string; unit_price_fen: number; quantity: number; line_amount_fen: number }>;
      total_fen: number;
    };
    type Skip = { student: { id: string; name: string; campus_id: string }; reason: string };
    const lines: Line[] = [];
    const skipped: Skip[] = [];
    if (students.length === 0) return { lines, skipped };

    // 批量查价：只查需要的（校区，收费项目）组合
    const campusIds = Array.from(new Set(students.map((s) => s.campus_id)));
    const feeItemIds = Array.from(new Set(
      students.map((s) => s.fee_item_id).filter((id): id is string => !!id && feeItemMap.has(id)),
    ));
    const priceMap = await this.courseService.getEffectivePriceMap(campusIds, feeItemIds, new Date());

    for (const s of students) {
      if (!s.fee_item_id) {
        skipped.push({ student: s, reason: '未绑定收费项目' });
        continue;
      }
      const feeItem = feeItemMap.get(s.fee_item_id);
      if (!feeItem) {
        skipped.push({ student: s, reason: '绑定的收费项目不在本收费期内' });
        continue;
      }
      const price = priceMap.get(`${s.campus_id}::${s.fee_item_id}`);
      if (!price) {
        skipped.push({ student: s, reason: '该校区下绑定的收费项目无有效价格' });
        continue;
      }
      const unitPrice = Number(price.amount_fen);
      const items = [{
        fee_item_id: feeItem.id,
        name: feeItem.name,
        unit_price_fen: unitPrice,
        quantity: 1,
        line_amount_fen: unitPrice,
      }];
      lines.push({ student: s, feeItem, items, total_fen: unitPrice });
    }
    return { lines, skipped };
  }

  private genInvoiceNo(): string {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `INV${ymd}${this.crypto.randomHex(6).toUpperCase()}`;
  }
}
