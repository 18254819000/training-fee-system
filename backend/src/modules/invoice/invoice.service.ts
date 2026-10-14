import {
  BadRequestException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CampusScopeService } from '../../common/guards/campus-scope.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserInfo } from '../../common/types';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { GenerateInvoiceDto, InvoiceQueryDto } from './dto/invoice.dto';
import { createHash } from 'crypto';

// 账单服务：后台生成账单（家长确认缴费模式）
// 新链路：校区 → 收费期 → 收费项目 → 预览 → 一键生成
// - 收费期只属于一个校区；收费项目直挂校区与价格；每名学生绑定一个收费项目
// - 金额全部由服务端按收费项目价格计算，账单保存项目名称+单价快照；
// - 同一学生+收费期+账单类型防重复（预查排除已有账单 + 数据库唯一键兜底，验收 F-11）
@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly scope: CampusScopeService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
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

  /** 生成预览：按收费项目分组展示将生成的账单（不写库） */
  async preview(user: AdminUserInfo, dto: GenerateInvoiceDto) {
    const { campus, period, feeItems, targets, skipped } = await this.resolveTargets(user, dto);
    const lines = targets.map((t) => this.toBillLine(t.student, t.feeItem));
    const totalFen = lines.reduce((s, l) => s + l.total_fen, 0);
    return {
      preview: true,
      count: lines.length,
      total_fen: totalFen,
      campus: { id: campus.id, name: campus.name },
      fee_period: { id: period.id, name: period.name },
      groups: feeItems.map((fi) => {
        const ls = lines.filter((l) => l.fee_item_id === fi.id);
        return {
          fee_item_id: fi.id,
          fee_item_name: fi.name,
          amount_fen: Number(fi.amount_fen),
          count: ls.length,
          students: ls.map((l) => ({ student_id: l.student_id, student_name: l.student_name })),
        };
      }).filter((g) => g.count > 0),
      students: lines.map((l) => ({
        student_id: l.student_id,
        student_name: l.student_name,
        campus_id: l.campus_id,
        fee_item_id: l.fee_item_id,
        fee_item_name: l.fee_item_name,
        amount_fen: l.total_fen,
      })),
      skipped: skipped.map((s) => ({
        student_id: s.student.id, student_name: s.student.name, reason: s.reason,
      })),
    };
  }

  /** 批量生成账单（幂等）：校区 → 收费期 → 收费项目，每名学生按其绑定的收费项目生成 */
  async generate(user: AdminUserInfo, dto: GenerateInvoiceDto, requestId: string, ip: string) {
    const itemKey = (dto.fee_item_ids || []).slice().sort().join(',');
    const rawKey = dto.idempotency_key || `invoice-batch:${user.id}:${dto.campus_id}:${dto.fee_period_id}:${itemKey}:${Date.now()}`;
    // idempotency_keys.key 列限长 128，收费项目多时原始 key 会超长 → 超长时用 sha256 压缩
    const key = rawKey.length <= 100 ? rawKey : `invoice-batch:${createHash('sha256').update(rawKey).digest('hex')}`;
    return this.idempotency.execute('invoice-batch', key, 3600, async () => {
      const { campus, period, targets, skipped } = await this.resolveTargets(user, dto);
      const lines = targets.map((t) => this.toBillLine(t.student, t.feeItem));
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
                student_id: line.student_id,
                campus_id: line.campus_id,
                fee_period_id: period.id,
                amount_due_fen: BigInt(line.total_fen),
                status: 'pending',
                created_by: user.id,
                invoice_items: {
                  create: [{
                    fee_item_id: line.fee_item_id,
                    item_name_snapshot: line.fee_item_name,
                    unit_price_fen: BigInt(line.total_fen),
                    quantity: 1,
                    line_amount_fen: BigInt(line.total_fen),
                  }],
                },
              },
            });
            created++;
            invoices.push({
              id: invoice.id, invoice_no: invoice.invoice_no,
              student_id: line.student_id, student_name: line.student_name, total_fen: line.total_fen,
            });
          } catch (e: any) {
            // 唯一冲突 = 该学生本期已有主账单（并发兜底）→ 跳过并明确提示（验收 F-11）
            if (e?.code === 'P2002') {
              skippedAll.push({ student_id: line.student_id, student_name: line.student_name, reason: '本期已有账单' });
              continue;
            }
            throw e;
          }
        }
      });

      await this.audit.log({
        actorType: 'admin', actorId: user.id, action: 'invoice.batch_generate', result: 'success',
        requestId, ip,
        metadata: { campus_id: campus.id, fee_period_id: period.id, created, skipped_count: skippedAll.length },
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
   * 解析目标：校区 → 收费期（须开放且属于该校区）→ 收费项目（本期绑定的启用项目）
   * → 本校区在读学生，按绑定关系分为可生成 targets 与 skipped（未绑定/项目不在本期/已有账单）。
   */
  private async resolveTargets(user: AdminUserInfo, dto: GenerateInvoiceDto) {
    // 1) 校区
    const campus = await this.prisma.campus.findUnique({ where: { id: dto.campus_id } });
    if (!campus || campus.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_CAMPUS_INVALID', message: '校区无效或已停用' });
    }
    this.scope.assertCampus(user, campus.id, '校区');

    // 2) 收费期：必须开放且属于该校区
    const period = await this.prisma.feePeriod.findUnique({
      where: { id: dto.fee_period_id },
      include: { fee_item_periods: { include: { fee_item: true } } },
    });
    if (!period) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });
    if (period.status !== 'open') {
      throw new BadRequestException({ code: 'ERR_PERIOD_NOT_OPEN', message: '只有开放中的收费期可以生成账单' });
    }
    if (period.campus_id !== campus.id) {
      throw new BadRequestException({ code: 'ERR_PERIOD_CAMPUS_MISMATCH', message: '该收费期不属于所选校区' });
    }

    // 3) 收费项目：本期绑定的启用项目（可用 fee_item_ids 缩小范围）
    let feeItems = period.fee_item_periods
      .map((fp) => fp.fee_item)
      .filter((fi) => fi.status === 'active');
    if (dto.fee_item_ids && dto.fee_item_ids.length > 0) {
      const boundIds = new Set(feeItems.map((fi) => fi.id));
      const invalid = dto.fee_item_ids.filter((id) => !boundIds.has(id));
      if (invalid.length > 0) {
        throw new BadRequestException({ code: 'ERR_FEE_ITEM_NOT_IN_PERIOD', message: '所选收费项目不在本收费期绑定范围内' });
      }
      const wanted = new Set(dto.fee_item_ids);
      feeItems = feeItems.filter((fi) => wanted.has(fi.id));
    }
    if (feeItems.length === 0) {
      throw new BadRequestException({ code: 'ERR_NO_FEE_ITEMS', message: '该收费期未绑定任何启用的收费项目' });
    }
    const feeItemMap = new Map(feeItems.map((fi) => [fi.id, fi]));

    // 4) 本校区在读学生
    const allStudents = await this.prisma.student.findMany({
      where: { status: 'active', campus_id: campus.id },
      select: { id: true, name: true, campus_id: true, fee_item_id: true },
    });

    // 5) 幂等预查：排除本期已有账单的学生
    const existing = allStudents.length > 0
      ? await this.prisma.invoice.findMany({
        where: { fee_period_id: period.id, student_id: { in: allStudents.map((s) => s.id) } },
        select: { student_id: true },
      })
      : [];
    const existingSet = new Set(existing.map((e) => e.student_id));

    // 6) 按绑定关系分类
    type Target = { student: { id: string; name: string; campus_id: string }; feeItem: { id: string; name: string; amount_fen: bigint } };
    type Skip = { student: { id: string; name: string; campus_id: string }; reason: string };
    const targets: Target[] = [];
    const skipped: Skip[] = [];
    for (const s of allStudents) {
      if (existingSet.has(s.id)) {
        skipped.push({ student: s, reason: '本期已有账单' });
        continue;
      }
      if (!s.fee_item_id) {
        skipped.push({ student: s, reason: '未绑定收费项目' });
        continue;
      }
      const feeItem = feeItemMap.get(s.fee_item_id);
      if (!feeItem) {
        skipped.push({ student: s, reason: '绑定的收费项目不在本收费期内' });
        continue;
      }
      targets.push({ student: s, feeItem: { id: feeItem.id, name: feeItem.name, amount_fen: feeItem.amount_fen } });
    }
    return { campus, period, feeItems, targets, skipped };
  }

  /** 单名学生账单行：金额直接取收费项目价格 */
  private toBillLine(
    student: { id: string; name: string; campus_id: string },
    feeItem: { id: string; name: string; amount_fen: bigint },
  ) {
    const totalFen = Number(feeItem.amount_fen);
    return {
      student_id: student.id,
      student_name: student.name,
      campus_id: student.campus_id,
      fee_item_id: feeItem.id,
      fee_item_name: feeItem.name,
      total_fen: totalFen,
    };
  }

  private genInvoiceNo(): string {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `INV${ymd}${this.crypto.randomHex(6).toUpperCase()}`;
  }
}
