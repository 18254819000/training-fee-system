import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CampusScopeService } from '../../common/guards/campus-scope.service';
import { RedisService } from '../../common/redis/redis.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserInfo } from '../../common/types';

// 报表服务：收费统计 + 受控导出（任务制）
// 导出流程：POST /exports 建任务 → 同步生成 CSV → 任务 completed → GET 任务状态拿 downloadUrl → 下载
// 文件保留 24 小时后清理；CSV 带 BOM 以便 Excel 直接打开
export type ExportType = 'orders_csv' | 'invoices_csv' | 'students_csv';

export interface ExportTask {
  task_id: string;
  type: ExportType;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  file_name: string | null;
  download_url: string | null;
  row_count: number;
  error: string | null;
  created_by: string;
  created_at: string;
  expires_at: string;
}

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);
  private readonly exportDir = process.env.EXPORT_DIR || '/tmp/tfs-exports';

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CampusScopeService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {
    fs.mkdirSync(this.exportDir, { recursive: true });
  }

  // ─── 收费统计 ───

  async collections(
    user: AdminUserInfo,
    query: { campus_id?: string; fee_period_id?: string; date_from?: string; date_to?: string },
  ) {
    const scopeFilter = this.scope.scopeFilter(user);
    const campusId = query.campus_id;
    if (campusId) this.scope.assertCampus(user, campusId, '校区');
    // 行级校区范围：显式 campus_id > 用户可管校区集合 > 全部
    const scopedCampusIds: string[] | null = campusId
      ? [campusId]
      : scopeFilter
        ? scopeFilter.in
        : null;
    const campusCond = scopedCampusIds ? { in: scopedCampusIds } : undefined;

    const dateFilter: any = {};
    if (query.date_from) dateFilter.gte = new Date(query.date_from);
    if (query.date_to) dateFilter.lte = new Date(query.date_to);
    const hasDate = Object.keys(dateFilter).length > 0;

    const invoiceWhere: any = { status: { not: 'voided' } };
    if (campusCond) invoiceWhere.campus_id = campusCond;
    if (query.fee_period_id) invoiceWhere.fee_period_id = query.fee_period_id;
    if (hasDate) invoiceWhere.created_at = dateFilter;

    const orderWhere: any = { status: 'paid' };
    if (campusCond) orderWhere.invoice = { campus_id: campusCond };
    if (query.fee_period_id) orderWhere.invoice = { ...(orderWhere.invoice || {}), fee_period_id: query.fee_period_id };
    if (hasDate) orderWhere.paid_at = dateFilter;

    const refundWhere: any = { status: 'success' };
    if (campusCond || query.fee_period_id) {
      refundWhere.payment_order = {
        invoice: {
          ...(campusCond ? { campus_id: campusCond } : {}),
          ...(query.fee_period_id ? { fee_period_id: query.fee_period_id } : {}),
        },
      };
    }

    const [invoices, orders, refunds, statusGroups] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: invoiceWhere,
        _sum: { amount_due_fen: true, amount_paid_fen: true, amount_refunded_fen: true },
        _count: true,
      }),
      this.prisma.paymentOrder.aggregate({ where: orderWhere, _sum: { amount_fen: true }, _count: true }),
      this.prisma.refund.aggregate({ where: refundWhere, _sum: { amount_fen: true }, _count: true }),
      this.prisma.invoice.groupBy({ by: ['status'], where: invoiceWhere, _count: true }),
    ]);

    const receivable = Number(invoices._sum.amount_due_fen || 0n);
    const invoicePaid = Number(invoices._sum.amount_paid_fen || 0n);
    const collected = Number(orders._sum.amount_fen || 0n);
    const refunded = Number(refunds._sum.amount_fen || 0n);
    // 字段名与管理端 CollectionStats 对齐（snake_case，经拦截器转 camelCase）：
    // received_fen=实收，pending_fen=待收，order_count=账单数
    return {
      receivable_fen: receivable,
      received_fen: collected,
      refunded_fen: refunded,
      pending_fen: Math.max(0, receivable - invoicePaid),
      order_count: invoices._count,
      paid_order_count: orders._count,
      refund_count: refunds._count,
      invoice_status: statusGroups.map((g) => ({ status: g.status, count: g._count })),
      filters: { campus_ids: scopedCampusIds, fee_period_id: query.fee_period_id || null },
    };
  }

  // ─── 收费期缴费统计：按收费项目分组（人数/已缴/未缴） ───

  async feePeriodSummary(
    user: AdminUserInfo,
    query: { fee_period_id?: string; campus_id?: string },
  ) {
    const scopeFilter = this.scope.scopeFilter(user);
    const feePeriodId = query.fee_period_id;
    if (feePeriodId) {
      const fp = await this.prisma.feePeriod.findUnique({ where: { id: feePeriodId }, select: { campus_id: true, name: true } });
      if (!fp) throw new BadRequestException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });
      this.scope.assertCampus(user, fp.campus_id, '收费期');
    }
    const campusId = query.campus_id;
    if (campusId) this.scope.assertCampus(user, campusId, '校区');
    const scopedCampusIds: string[] | null = campusId
      ? [campusId]
      : scopeFilter
        ? scopeFilter.in
        : null;

    const invoiceWhere: any = { status: { not: 'voided' } };
    if (scopedCampusIds) invoiceWhere.campus_id = { in: scopedCampusIds };
    if (feePeriodId) invoiceWhere.fee_period_id = feePeriodId;

    // 按学生绑定的收费项目分组统计账单
    const invoices = await this.prisma.invoice.findMany({
      where: invoiceWhere,
      select: {
        id: true, status: true,
        amount_due_fen: true, amount_paid_fen: true,
        student: { select: { fee_item: { select: { id: true, name: true } } } },
      },
    });

    const byItem = new Map<string, {
      fee_item_id: string; fee_item_name: string;
      total: number; paid: number; unpaid: number;
      receivable_fen: number; received_fen: number;
    }>();
    for (const inv of invoices) {
      const fi = inv.student?.fee_item;
      const key = fi?.id || '__none__';
      let row = byItem.get(key);
      if (!row) {
        row = {
          fee_item_id: fi?.id || '',
          fee_item_name: fi?.name || '未绑定课程',
          total: 0, paid: 0, unpaid: 0,
          receivable_fen: 0, received_fen: 0,
        };
        byItem.set(key, row);
      }
      row.total += 1;
      if (inv.status === 'paid') row.paid += 1;
      else row.unpaid += 1; // pending/processing 等均计为未缴
      row.receivable_fen += Number(inv.amount_due_fen || 0n);
      row.received_fen += Number(inv.amount_paid_fen || 0n);
    }
    const items = [...byItem.values()].sort((a, b) => a.fee_item_name.localeCompare(b.fee_item_name, 'zh'));
    const total = items.reduce((s, r) => ({ total: s.total + r.total, paid: s.paid + r.paid, unpaid: s.unpaid + r.unpaid, receivable_fen: s.receivable_fen + r.receivable_fen, received_fen: s.received_fen + r.received_fen }), { total: 0, paid: 0, unpaid: 0, receivable_fen: 0, received_fen: 0 });
    return { items, total, filters: { fee_period_id: feePeriodId || null, campus_ids: scopedCampusIds } };
  }

  // ─── 受控导出（任务制） ───

  private taskKey(taskId: string): string {
    return `tfs:export-task:${taskId}`;
  }

  async createExport(
    user: AdminUserInfo,
    type: string,
    filters: Record<string, any> | undefined,
    requestId: string,
    ip: string,
  ) {
    if (!['orders_csv', 'invoices_csv', 'students_csv'].includes(type)) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: `不支持的导出类型：${type}` });
    }
    const taskId = `exp_${this.crypto.randomHex(8)}`;
    const task: ExportTask = {
      task_id: taskId, type: type as ExportType, status: 'processing',
      file_name: null, download_url: null, row_count: 0, error: null,
      created_by: user.id, created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    };
    await this.redis.set(this.taskKey(taskId), JSON.stringify(task), 24 * 3600);

    try {
      const rows = await this.buildRows(user, type as ExportType, filters || {});
      const csv = this.toCsv(rows);
      const fileName = `${type}_${new Date().toISOString().slice(0, 10)}_${taskId}.csv`;
      const filePath = path.join(this.exportDir, fileName);
      fs.writeFileSync(filePath, '\uFEFF' + csv, 'utf8'); // BOM：Excel 直接打开不乱码
      task.status = 'completed';
      task.file_name = fileName;
      task.download_url = `/admin/reports/exports/${taskId}/download`;
      task.row_count = rows.length - 1;
    } catch (e: any) {
      task.status = 'failed';
      task.error = e?.message || '导出失败';
      this.logger.error(`[${requestId}] 导出失败 task=${taskId}`, e?.stack);
    }
    await this.redis.set(this.taskKey(taskId), JSON.stringify(task), 24 * 3600);

    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'report.export',
      resourceType: 'export_task', resourceId: taskId, result: task.status === 'completed' ? 'success' : 'fail',
      requestId, ip, metadata: { type, row_count: task.row_count },
    });
    return { task_id: taskId };
  }

  async getExportTask(user: AdminUserInfo, taskId: string): Promise<ExportTask> {
    const raw = await this.redis.get(this.taskKey(taskId));
    if (!raw) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '导出任务不存在或已过期' });
    const task = JSON.parse(raw) as ExportTask;
    if (task.created_by !== user.id && user.roles.includes("super_admin") !== true) {
      // 非超管只能查自己的任务（行级隔离）
      throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '导出任务不存在或已过期' });
    }
    return task;
  }

  async downloadPath(user: AdminUserInfo, taskId: string): Promise<{ path: string; fileName: string }> {
    const task = await this.getExportTask(user, taskId);
    if (task.status !== 'completed' || !task.file_name) {
      throw new BadRequestException({ code: 'ERR_EXPORT_STATE', message: '导出任务尚未完成' });
    }
    const filePath = path.join(this.exportDir, task.file_name);
    if (!filePath.startsWith(this.exportDir) || !fs.existsSync(filePath)) {
      throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '导出文件不存在或已清理' });
    }
    return { path: filePath, fileName: task.file_name };
  }

  // ─── 行数据构造（含校区行级校验） ───

  /** 返回用户可见的校区 id 列表（null = 全部）；显式 campus_id 会先做行级校验 */
  private scopedCampusIds(user: AdminUserInfo, filters: Record<string, any>): string[] | null {
    const campusId = filters.campus_id as string | undefined;
    if (campusId) {
      this.scope.assertCampus(user, campusId, '校区');
      return [campusId];
    }
    const scopeFilter = this.scope.scopeFilter(user);
    return scopeFilter ? scopeFilter.in : null;
  }

  private async buildRows(user: AdminUserInfo, type: ExportType, filters: Record<string, any>) {
    const campusIds = this.scopedCampusIds(user, filters);
    const campusCond = campusIds ? { in: campusIds } : undefined;
    const limit = 10000; // 导出上限，防内存爆炸
    if (type === 'orders_csv') {
      const where: any = {};
      if (campusCond) where.invoice = { campus_id: campusCond };
      if (filters.status) where.status = filters.status;
      const orders = await this.prisma.paymentOrder.findMany({
        where, take: limit, orderBy: { created_at: 'desc' },
        include: { invoice: { include: { student: true, campus: true, fee_period: true } } },
      });
      return [
        ['订单号', '微信交易号', '账单号', '学员', '校区', '收费期', '金额(元)', '状态', '创建时间', '支付时间'],
        ...orders.map((o) => [
          o.out_trade_no, o.wechat_transaction_id || '', o.invoice.invoice_no,
          o.invoice.student.name, o.invoice.campus.name, o.invoice.fee_period.name,
          (Number(o.amount_fen) / 100).toFixed(2), o.status,
          o.created_at.toISOString(), o.paid_at ? o.paid_at.toISOString() : '',
        ]),
      ];
    }
    if (type === 'invoices_csv') {
      const where: any = {};
      if (campusCond) where.campus_id = campusCond;
      if (filters.fee_period_id) where.fee_period_id = filters.fee_period_id;
      if (filters.status) where.status = filters.status;
      const invoices = await this.prisma.invoice.findMany({
        where, take: limit, orderBy: { created_at: 'desc' },
        include: { student: true, campus: true, fee_period: true },
      });
      return [
        ['账单号', '学员', '校区', '收费期', '应收(元)', '已付(元)', '已退(元)', '状态', '创建时间'],
        ...invoices.map((i) => [
          i.invoice_no, i.student.name, i.campus.name, i.fee_period.name,
          (Number(i.amount_due_fen) / 100).toFixed(2),
          (Number(i.amount_paid_fen) / 100).toFixed(2),
          (Number(i.amount_refunded_fen) / 100).toFixed(2),
          i.status, i.created_at.toISOString(),
        ]),
      ];
    }
    // students_csv（最小化：不含手机号明文以外的敏感信息）
    const where: any = {};
    if (campusCond) where.campus_id = campusCond;
    if (filters.status) where.status = filters.status;
    const students = await this.prisma.student.findMany({
      where, take: limit, orderBy: { created_at: 'desc' },
      include: { campus: true },
    });
    return [
      ['内部学号', '姓名', '校区', '年级/班级', '状态', '创建时间'],
      ...students.map((s) => [
        s.student_no || '', s.name, s.campus.name, s.grade_or_class || '', s.status, s.created_at.toISOString(),
      ]),
    ];
  }

  private toCsv(rows: any[][]): string {
    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return rows.map((r) => r.map(esc).join(',')).join('\n');
  }
}
