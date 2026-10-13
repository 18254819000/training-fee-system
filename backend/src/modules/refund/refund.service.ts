import {
  BadRequestException, ConflictException, Injectable, Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CampusScopeService } from '../../common/guards/campus-scope.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { WechatPayService } from '../wechat-pay/wechat-pay.service';
import { AdminUserInfo, StudentSessionInfo } from '../../common/types';
import { RefundQueryDto } from './dto/refund-query.dto';

// 退款服务：仅全额退款、防重申请、提交微信、状态同步
// 铁律：
// - 仅允许对已支付订单做全额退款（验收 F-20）
// - 同一支付订单不允许存在进行中的退款单（防重）
// - 退款终态以微信通知/查单为准，本地 finalize 幂等
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly scope: CampusScopeService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly wechatPay: WechatPayService,
  ) {}

  // ─── 申请退款（仅全额） ───

  async apply(
    user: AdminUserInfo,
    paymentOrderId: string,
    reason: string,
    amountFen: number | undefined,
    idempotencyKey: string | undefined,
    requestId: string,
    ip: string,
  ) {
    const key = idempotencyKey || `refund-apply-${paymentOrderId}`;
    return this.idempotency.execute('refund-apply', key, 900, async () => {
      const order = await this.prisma.paymentOrder.findUnique({
        where: { id: paymentOrderId },
        include: { invoice: true },
      });
      if (!order) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '支付订单不存在' });
      this.scope.assertCampus(user, order.invoice.campus_id, '退款');
      if (order.status !== 'paid') {
        throw new BadRequestException({ code: 'ERR_REFUND_STATE', message: '仅已支付的订单可以退款' });
      }
      // 防重：同一支付订单已有进行中退款单 → 409（验收 F-20）
      const existing = await this.prisma.refund.findFirst({
        where: { payment_order_id: paymentOrderId, status: { in: ['created', 'submitted'] } },
      });
      if (existing) {
        throw new ConflictException({ code: 'ERR_REFUND_DUPLICATE', message: '该订单已有进行中的退款单' });
      }
      // 一期仅支持全额退款：退款金额必须等于订单实付金额
      const fullFen = Number(order.amount_fen);
      if (amountFen !== undefined && Number(amountFen) !== fullFen) {
        throw new BadRequestException({ code: 'ERR_REFUND_AMOUNT', message: '一期仅支持全额退款' });
      }
      if (!reason || reason.trim().length === 0) {
        throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '退款原因不能为空' });
      }

      const refundNo = this.genRefundNo();
      const refund = await this.prisma.$transaction(async (tx) => {
        const r = await tx.refund.create({
          data: {
            refund_no: refundNo,
            payment_order_id: order.id,
            amount_fen: BigInt(fullFen),
            reason: reason.trim(),
            status: 'created',
            requested_by: user.id,
          },
        });
        await tx.invoice.update({
          where: { id: order.invoice_id },
          data: { status: 'refunding' },
        });
        return r;
      });

      await this.audit.log({
        actorType: 'admin', actorId: user.id, action: 'refund.apply',
        resourceType: 'refund', resourceId: refund.id, result: 'success',
        requestId, ip,
        metadata: { payment_order_id: order.id, amount_fen: fullFen, reason },
      });
      return refund;
    }).then((r) => r.result);
  }

  // ─── 提交到微信 ───

  async submit(user: AdminUserInfo, id: string, requestId: string, ip: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: { payment_order: { include: { invoice: true, payment_account: true } } },
    });
    if (!refund) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '退款单不存在' });
    this.scope.assertCampus(user, refund.payment_order.invoice.campus_id, '退款');
    if (refund.status !== 'created') {
      throw new BadRequestException({ code: 'ERR_REFUND_STATE', message: `退款单当前状态（${refund.status}）不允许提交` });
    }

    const account = refund.payment_order.payment_account;
    // Mock 模式：直接标记提交成功，等待通知/模拟回调
    if (this.wechatPay.isMockMode()) {
      const updated = await this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: 'submitted' },
      });
      await this.audit.log({
        actorType: 'admin', actorId: user.id, action: 'refund.submit',
        resourceType: 'refund', resourceId: id, result: 'success', requestId, ip,
        metadata: { mode: 'mock' },
      });
      return updated;
    }

    // 真实模式：调用微信退款接口（结构已预留）
    throw new BadRequestException({
      code: 'ERR_NOT_IMPLEMENTED',
      message: '真实微信退款提交需在接入真实商户号后启用（当前为 Mock 模式）',
    });
  }

  // ─── 同步退款状态（查单） ───

  async sync(user: AdminUserInfo, id: string, requestId: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: { payment_order: { include: { invoice: true, payment_account: true } } },
    });
    if (!refund) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '退款单不存在' });
    this.scope.assertCampus(user, refund.payment_order.invoice.campus_id, '退款');
    if (['success', 'closed', 'failed'].includes(refund.status)) {
      return { refund_id: id, status: refund.status, synced: false, reason: '终态退款单无需同步' };
    }
    if (this.wechatPay.isMockMode()) {
      // Mock 模式：以本地记录为准，不对外查询
      return { refund_id: id, status: refund.status, synced: true, mode: 'mock' };
    }
    // 真实模式：调用微信查询退款接口后 finalize（预留）
    throw new BadRequestException({
      code: 'ERR_NOT_IMPLEMENTED',
      message: '真实退款查单需在接入真实商户号后启用',
    });
  }

  /** Mock 专用：模拟微信退款成功回调（联调测试） */
  async simulateSuccess(id: string, user: AdminUserInfo, requestId: string) {
    if (this.wechatPay.isMockMode() === false || process.env.NODE_ENV === 'production') {
      throw new BadRequestException({ code: 'ERR_FORBIDDEN', message: '仅 Mock 模式非生产环境可用' });
    }
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '退款单不存在' });
    await this.prisma.refund.update({ where: { id }, data: { status: 'submitted' } });
    await this.wechatPay.finalizeRefund(refund.refund_no, `mock-refund-${Date.now()}`, requestId);
    return this.prisma.refund.findUnique({ where: { id } });
  }

  // ─── 查询 ───

  async list(
    user: AdminUserInfo,
    query: RefundQueryDto,
  ) {
    const page = query.page || 1;
    const pageSize = Math.min(query.pageSize || 20, 100);
    const where: any = {};
    const scopeFilter = this.scope.scopeFilter(user);
    if (query.campus_id) {
      this.scope.assertCampus(user, query.campus_id, '校区');
      where.payment_order = { invoice: { campus_id: query.campus_id } };
    } else if (scopeFilter) {
      where.payment_order = { invoice: { campus_id: scopeFilter } };
    }
    if (query.status) where.status = query.status;
    const [total, items] = await Promise.all([
      this.prisma.refund.count({ where }),
      this.prisma.refund.findMany({
        where,
        include: {
          payment_order: {
            select: {
              id: true, out_trade_no: true,
              invoice: { select: { id: true, invoice_no: true, student: { select: { name: true } } } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items, total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize) };
  }

  async get(user: AdminUserInfo, id: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: {
        payment_order: {
          include: { invoice: { include: { student: true, campus: true } } },
        },
      },
    });
    if (!refund) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '退款单不存在' });
    this.scope.assertCampus(user, refund.payment_order.invoice.campus_id, '退款');
    return refund;
  }

  async studentList(session: StudentSessionInfo) {
    return this.prisma.refund.findMany({
      where: { payment_order: { invoice: { student_id: { in: session.studentIds } } } },
      include: {
        payment_order: { select: { id: true, out_trade_no: true, invoice: { select: { id: true, invoice_no: true } } } },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
  }

  private genRefundNo(): string {
    const d = new Date();
    const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    return `RF${ts}${this.crypto.randomHex(6).toUpperCase()}`;
  }
}
