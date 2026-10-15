import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CampusScopeService } from '../../common/guards/campus-scope.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserInfo, StudentSessionInfo } from '../../common/types';
import {
  AdapterContext, MockWechatPayAdapter, NotifyEvent,
  RealWechatPayAdapter, WechatPayAdapter,
} from './wechat-pay.adapter';
import { PaymentQueryDto } from './dto/payment-query.dto';

// 微信支付服务：JSAPI 下单 / 支付通知 / 退款通知 / 查单
// 铁律：
// - 金额全部由服务端按账单计算，前端传入金额一律忽略
// - 通知先验签解密，再校验商户号/AppID/订单号/金额，最后幂等入账
// - 最终支付状态只以服务端验证后的通知或查单为准
@Injectable()
export class WechatPayService {
  private readonly logger = new Logger(WechatPayService.name);
  private readonly mockAdapter = new MockWechatPayAdapter();
  private readonly realAdapter = new RealWechatPayAdapter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly scope: CampusScopeService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  isMockMode(): boolean {
    return (process.env.WECHAT_PAY_MODE || 'mock') === 'mock';
  }

  private adapter(): WechatPayAdapter {
    return this.isMockMode() ? this.mockAdapter : this.realAdapter;
  }

  /** 供退款服务调用微信退款接口（真实模式） */
  async createWechatRefund(
    account: {
      private_key_secret_ref: string | null;
      apiv3_secret_ref: string | null;
      platform_key_config_ref: string | null;
      merchant_cert_serial: string | null;
      mch_id: string | null;
      notify_url: string | null;
      app_id: string | null;
    },
    req: {
      outTradeNo: string;
      outRefundNo: string;
      reason: string;
      refundFen: number;
      totalFen: number;
    },
  ) {
    const ctx = this.buildContext(account);
    return this.adapter().createRefund(
      { ...req, appId: account.app_id || '', mchId: account.mch_id || '', notifyUrl: account.notify_url || undefined },
      ctx,
    );
  }

  /** 由支付账户配置构造适配器上下文（密钥只经引用解析，不落日志） */
  private buildContext(account: {
    private_key_secret_ref: string | null;
    apiv3_secret_ref: string | null;
    platform_key_config_ref: string | null;
    merchant_cert_serial: string | null;
  }): AdapterContext {
    return {
      privateKeyPem: this.crypto.resolveSecretRef(account.private_key_secret_ref, '商户私钥'),
      certSerial: account.merchant_cert_serial || '',
      apiv3Key: this.crypto.resolveSecretRef(account.apiv3_secret_ref, 'APIv3 密钥'),
      platformPublicKeyPem: this.crypto.resolveSecretRef(account.platform_key_config_ref, '微信支付平台公钥'),
    };
  }

  /** 为校区挑选启用的支付账户：优先校区专属，其次全局；生产环境优先 */
  async findActiveAccount(campusId: string) {
    const accounts = await this.prisma.paymentAccount.findMany({
      where: { status: 'active' },
      include: { payment_account_campuses: true },
      orderBy: { updated_at: 'desc' },
    });
    if (accounts.length === 0) {
      throw new BadRequestException({ code: 'ERR_NO_PAYMENT_ACCOUNT', message: '未配置可用的微信支付账户，请联系管理员' });
    }
    const campusSpecific = accounts.filter((a) =>
      a.payment_account_campuses.some((c) => c.campus_id === campusId),
    );
    const global = accounts.filter((a) => a.payment_account_campuses.length === 0);
    const pick = (list: typeof accounts) =>
      list.find((a) => a.environment === 'production') || list[0];
    return pick(campusSpecific) || pick(global) || null;
  }

  // ─── 学生端：创建支付订单 ───

  async createOrder(
    session: StudentSessionInfo,
    invoiceId: string,
    idempotencyKey: string | undefined,
    requestId: string,
    ip: string,
  ) {
    const key = idempotencyKey || `pay-${invoiceId}`;
    return this.idempotency.execute('payment-order', key, 900, async () => {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { student: true, fee_period: true },
      });
      if (!invoice) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '账单不存在' });
      if (!session.studentIds.includes(invoice.student_id)) {
        throw new ForbiddenException({ code: 'ERR_FORBIDDEN', message: '无权操作该账单' });
      }
      if (!['pending', 'processing'].includes(invoice.status)) {
        throw new BadRequestException({ code: 'ERR_INVOICE_STATE', message: '该账单当前不可支付' });
      }
      // 服务端算价：应收 - 已付（前端金额一律忽略）
      const dueFen = Number(invoice.amount_due_fen) - Number(invoice.amount_paid_fen);
      if (dueFen <= 0) {
        throw new BadRequestException({ code: 'ERR_INVOICE_PAID', message: '该账单已付清' });
      }

      const account = await this.findActiveAccount(invoice.campus_id);
      if (!account) {
        throw new BadRequestException({ code: 'ERR_NO_PAYMENT_ACCOUNT', message: '未配置可用的微信支付账户' });
      }

      // 关闭该账单旧的待支付订单，避免并发有效订单（验收 F-19）
      await this.prisma.paymentOrder.updateMany({
        where: { invoice_id: invoiceId, status: { in: ['created', 'pending'] } },
        data: { status: 'closed' },
      });

      const outTradeNo = this.genOutTradeNo();
      const order = await this.prisma.paymentOrder.create({
        data: {
          out_trade_no: outTradeNo,
          invoice_id: invoiceId,
          payment_account_id: account.id,
          channel: 'WECHAT',
          amount_fen: BigInt(dueFen),
          status: 'created',
        },
      });

      try {
        const ctx = this.buildContext(account);
        // JSAPI 真实下单需要付款人 openid（公众号网页授权绑定；Mock 模式可缺省）
        let openid: string | undefined;
        if (session.guardianId) {
          const guardian = await this.prisma.guardian.findUnique({ where: { id: session.guardianId } });
          openid = guardian?.wechat_openid || undefined;
        }
        const { prepayId, jsapiParams } = await this.adapter().createJsapiOrder(
          {
            appId: account.app_id,
            mchId: account.mch_id,
            outTradeNo,
            amountFen: dueFen,
            description: `学费-${invoice.fee_period.name}`.slice(0, 60),
            notifyUrl: account.notify_url,
            openid,
          },
          ctx,
        );
        await this.prisma.paymentOrder.update({
          where: { id: order.id },
          data: { prepay_id: prepayId, status: 'pending' },
        });
        await this.prisma.invoice.update({
          where: { id: invoiceId },
          data: { status: 'processing' },
        });
        await this.audit.log({
          actorType: 'student', actorId: session.guardianId, action: 'payment.order_create',
          resourceType: 'payment_order', resourceId: order.id, result: 'success', requestId, ip,
          metadata: { invoice_id: invoiceId, amount_fen: dueFen },
        });
        return { order: { ...order, status: 'pending', prepay_id: prepayId }, jsapi_params: jsapiParams };
      } catch (e: any) {
        await this.prisma.paymentOrder.update({
          where: { id: order.id },
          data: { status: 'failed' },
        });
        throw new BadRequestException({ code: 'ERR_PAY_ORDER_FAILED', message: `创建微信支付订单失败：${e.message || '未知错误'}` });
      }
    }).then((r) => r.result);
  }

  // ─── 支付通知（微信服务器回调，不依赖登录态） ───

  /** Express 层调用：返回微信协议要求的 {code,message}，一律 HTTP 200 */
  async handleNotify(
    headers: Record<string, string | undefined>, rawBody: Buffer, requestId: string,
  ): Promise<{ code: string; message: string }> {
    const digest = this.crypto.sha256(rawBody.toString('utf8'));
    try {
      const event = await this.verifyWithAnyAccount(headers, rawBody);
      if (!event) {
        await this.recordNotification(null, 'UNKNOWN', digest, false, 'rejected', 'ERR_BAD_SIGNATURE', requestId);
        this.logger.warn(`[${requestId}] 支付通知验签失败（可能伪造，验收 F-17）`);
        return { code: 'FAIL', message: '签名验证失败' };
      }
      return await this.applyPaidEvent(event, digest, requestId);
    } catch (e: any) {
      this.logger.error(`[${requestId}] 支付通知处理异常`, e?.stack);
      return { code: 'FAIL', message: '处理失败' };
    }
  }

  /** 用所有启用账户逐一验签（通常只有 1 个） */
  private async verifyWithAnyAccount(
    headers: Record<string, string | undefined>, rawBody: Buffer,
  ): Promise<NotifyEvent | null> {
    const accounts = await this.prisma.paymentAccount.findMany({ where: { status: 'active' } });
    for (const account of accounts) {
      try {
        const ctx = this.buildContext(account);
        const event = await this.adapter().verifyNotify(headers, rawBody, ctx);
        if (event) {
          // 顺带校验通知中的商户号/AppID 与账户一致
          if (event.mchId && event.mchId !== account.mch_id) continue;
          if (event.appId && event.appId !== account.app_id) continue;
          return event;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  /** 幂等入账核心（可单独测试） */
  async applyPaidEvent(
    event: NotifyEvent, payloadDigest: string, requestId: string,
  ): Promise<{ code: string; message: string }> {
    // 1. 通知去重：notification_id / payload_digest 唯一约束兜底（验收 F-16）
    try {
      await this.prisma.paymentNotification.create({
        data: {
          notification_id: event.id,
          out_trade_no: event.outTradeNo,
          event_type: event.eventType,
          payload_digest: payloadDigest,
          signature_verified: true,
          processing_status: 'verified',
          request_id: requestId,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        await this.prisma.paymentNotification.updateMany({
          where: { OR: [{ notification_id: event.id }, { payload_digest: payloadDigest }] },
          data: { processing_status: 'duplicate', processed_at: new Date() },
        });
        return { code: 'SUCCESS', message: '重复通知' };
      }
      throw e;
    }

    const reject = async (reason: string) => {
      await this.prisma.paymentNotification.updateMany({
        where: { notification_id: event.id },
        data: { processing_status: 'rejected', error_code: reason, processed_at: new Date() },
      });
      this.logger.warn(`[${requestId}] 支付通知被拒绝: ${reason}, out_trade_no=${event.outTradeNo}`);
      return { code: 'SUCCESS', message: '已拒绝' }; // 毒丸消息：停止微信重试
    };

    const order = await this.prisma.paymentOrder.findUnique({
      where: { out_trade_no: event.outTradeNo },
      include: { invoice: true },
    });
    if (!order) return reject('ERR_ORDER_NOT_FOUND');
    if (event.amountFen !== undefined && Number(event.amountFen) !== Number(order.amount_fen)) {
      await this.audit.log({
        actorType: 'system', action: 'payment.notify_amount_mismatch', resourceType: 'payment_order',
        resourceId: order.id, result: 'fail', requestId,
        metadata: { expected_fen: Number(order.amount_fen) },
      });
      return reject('ERR_AMOUNT_MISMATCH');
    }
    if (order.status === 'paid') {
      // 已入账（并发/重放）：直接成功
      await this.prisma.paymentNotification.updateMany({
        where: { notification_id: event.id },
        data: { processing_status: 'duplicate', processed_at: new Date() },
      });
      return { code: 'SUCCESS', message: '成功' };
    }

    if (event.tradeState && event.tradeState !== 'SUCCESS') {
      await this.prisma.$transaction([
        this.prisma.paymentOrder.update({ where: { id: order.id }, data: { status: 'failed' } }),
        this.prisma.paymentNotification.updateMany({
          where: { notification_id: event.id },
          data: { processing_status: 'processed', processed_at: new Date() },
        }),
      ]);
      return { code: 'SUCCESS', message: '成功' };
    }

    // 2. 事务入账
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.paymentOrder.update({
          where: { id: order.id },
          data: {
            status: 'paid',
            wechat_transaction_id: event.transactionId || null,
            paid_at: new Date(),
          },
        });
        const newPaid = Number(order.invoice.amount_paid_fen) + Number(order.amount_fen);
        await tx.invoice.update({
          where: { id: order.invoice_id },
          data: {
            amount_paid_fen: BigInt(newPaid),
            status: newPaid >= Number(order.invoice.amount_due_fen) ? 'paid' : 'processing',
          },
        });
        await tx.paymentNotification.updateMany({
          where: { notification_id: event.id },
          data: { processing_status: 'processed', processed_at: new Date() },
        });
      });
    } catch (e: any) {
      // 微信交易号唯一冲突 = 并发重复入账，视为已处理（验收 F-16/F-19）
      if (e?.code === 'P2002') {
        await this.prisma.paymentNotification.updateMany({
          where: { notification_id: event.id },
          data: { processing_status: 'duplicate', processed_at: new Date() },
        });
        return { code: 'SUCCESS', message: '成功' };
      }
      throw e;
    }

    await this.audit.log({
      actorType: 'system', action: 'payment.notify_paid', resourceType: 'payment_order',
      resourceId: order.id, result: 'success', requestId,
      metadata: { out_trade_no: event.outTradeNo },
    });
    return { code: 'SUCCESS', message: '成功' };
  }

  private async recordNotification(
    notificationId: string | null, eventType: string, digest: string,
    verified: boolean, status: 'rejected' | 'received', errorCode: string | null, requestId: string,
  ) {
    try {
      await this.prisma.paymentNotification.create({
        data: {
          notification_id: notificationId || `rejected-${digest.slice(0, 32)}`,
          out_trade_no: '',
          event_type: eventType,
          payload_digest: digest,
          signature_verified: verified,
          processing_status: status,
          error_code: errorCode,
          request_id: requestId,
        },
      });
    } catch {
      /* 去重冲突时忽略 */
    }
  }

  // ─── 退款通知 ───

  async handleRefundNotify(
    headers: Record<string, string | undefined>, rawBody: Buffer, requestId: string,
  ): Promise<{ code: string; message: string }> {
    try {
      const event = await this.verifyWithAnyAccount(headers, rawBody);
      if (!event || !event.outRefundNo) {
        return { code: 'FAIL', message: '签名验证失败' };
      }
      const digest = this.crypto.sha256(rawBody.toString('utf8'));
      try {
        await this.prisma.paymentNotification.create({
          data: {
            notification_id: event.id,
            out_trade_no: event.outTradeNo,
            event_type: event.eventType,
            payload_digest: digest,
            signature_verified: true,
            processing_status: 'verified',
            request_id: requestId,
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') return { code: 'SUCCESS', message: '重复通知' };
        throw e;
      }
      if (event.refundStatus === 'SUCCESS') {
        await this.finalizeRefund(event.outRefundNo, event.refundId || null, requestId);
      }
      await this.prisma.paymentNotification.updateMany({
        where: { notification_id: event.id },
        data: { processing_status: 'processed', processed_at: new Date() },
      });
      return { code: 'SUCCESS', message: '成功' };
    } catch (e: any) {
      this.logger.error(`[${requestId}] 退款通知处理异常`, e?.stack);
      return { code: 'FAIL', message: '处理失败' };
    }
  }

  /** 退款终态落定（通知/查单共用） */
  async finalizeRefund(refundNo: string, wechatRefundId: string | null, requestId: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { refund_no: refundNo },
      include: { payment_order: { include: { invoice: true } } },
    });
    if (!refund || refund.status === 'success') return;
    await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: refund.id },
        data: { status: 'success', wechat_refund_id: wechatRefundId, success_at: new Date() },
      });
      const invoice = refund.payment_order.invoice;
      const newRefunded = Number(invoice.amount_refunded_fen) + Number(refund.amount_fen);
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amount_refunded_fen: BigInt(newRefunded),
          status: newRefunded >= Number(invoice.amount_paid_fen) ? 'refunded' : 'refunding',
        },
      });
    });
    await this.audit.log({
      actorType: 'system', action: 'refund.success', resourceType: 'refund',
      resourceId: refund.id, result: 'success', requestId,
    });
  }

  // ─── 查单（受控，用于通知丢失/超时恢复，验收 F-18） ───

  async reconcile(orderId: string, admin: AdminUserInfo, requestId: string) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
      include: { invoice: true, payment_account: true },
    });
    if (!order) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '订单不存在' });
    this.scope.assertCampus(admin, order.invoice.campus_id, '订单');
    if (!['created', 'pending', 'failed'].includes(order.status)) {
      return { order_id: order.id, status: order.status, synced: false, reason: '终态订单无需查单' };
    }
    const ctx = this.buildContext(order.payment_account);
    const result = await this.adapter().queryOrder(order.out_trade_no, order.payment_account.mch_id, ctx);
    await this.prisma.paymentOrder.update({ where: { id: order.id }, data: { last_query_at: new Date() } });

    if (result.tradeState === 'SUCCESS' && order.status !== 'paid') {
      // 用查单结果补入账（与通知同一入账路径，保证一致）
      await this.applyPaidEvent({
        id: `reconcile-${order.out_trade_no}-${Date.now()}`,
        eventType: 'RECONCILE',
        summary: '管理员查单补入账',
        outTradeNo: order.out_trade_no,
        transactionId: result.transactionId,
        tradeState: 'SUCCESS',
        amountFen: Number(order.amount_fen),
      }, this.crypto.sha256(`reconcile:${order.out_trade_no}:${Date.now()}`), requestId);
      return { order_id: order.id, status: 'paid', synced: true };
    }
    if (result.tradeState === 'CLOSED' || result.tradeState === 'PAYERROR') {
      await this.prisma.paymentOrder.update({ where: { id: order.id }, data: { status: 'closed' } });
    }
    return { order_id: order.id, status: order.status, synced: true, trade_state: result.tradeState };
  }

  // ─── Mock 专用：模拟支付成功（仅 mock 模式 + 非生产环境，验收 F-15） ───

  async simulatePaid(orderId: string, admin: AdminUserInfo, requestId: string) {
    if (!this.isMockMode() || process.env.NODE_ENV === 'production') {
      throw new ForbiddenException({ code: 'ERR_FORBIDDEN', message: '仅 Mock 模式非生产环境可用' });
    }
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
      include: { invoice: true, payment_account: true },
    });
    if (!order) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '订单不存在' });
    this.scope.assertCampus(admin, order.invoice.campus_id, '订单');
    const { headers, rawBody } = this.mockAdapter.simulatePaid(
      order.out_trade_no, Number(order.amount_fen),
      order.payment_account.mch_id, order.payment_account.app_id,
    );
    return this.handleNotify(headers as Record<string, string>, rawBody, requestId);
  }

  // ─── 查询（管理端/学生端） ───

  async adminList(
    admin: AdminUserInfo,
    query: PaymentQueryDto,
  ) {
    const page = query.page || 1;
    const pageSize = Math.min(query.pageSize || 20, 100);
    const where: any = {};
    const scopeFilter = this.scope.scopeFilter(admin);
    if (query.campus_id) {
      this.scope.assertCampus(admin, query.campus_id, '校区');
      where.invoice = { campus_id: query.campus_id };
    } else if (scopeFilter) {
      where.invoice = { campus_id: scopeFilter };
    }
    if (query.fee_period_id) where.invoice = { ...(where.invoice || {}), fee_period_id: query.fee_period_id };
    if (query.status) where.status = query.status;
    if (query.out_trade_no) where.out_trade_no = { contains: query.out_trade_no };
    if (query.date_from || query.date_to) {
      where.created_at = {};
      if (query.date_from) where.created_at.gte = new Date(query.date_from);
      if (query.date_to) where.created_at.lte = new Date(query.date_to);
    }
    const [total, items] = await Promise.all([
      this.prisma.paymentOrder.count({ where }),
      this.prisma.paymentOrder.findMany({
        where,
        include: {
          invoice: { select: { id: true, invoice_no: true, campus_id: true, student: { select: { name: true } } } },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items, total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize) };
  }

  async adminGet(orderId: string, admin: AdminUserInfo) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
      include: { invoice: { include: { student: true, campus: true } } },
    });
    if (!order) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '订单不存在' });
    this.scope.assertCampus(admin, order.invoice.campus_id, '订单');
    // 不得显示密钥：payment_account 只返回脱敏摘要
    const account = await this.prisma.paymentAccount.findUnique({ where: { id: order.payment_account_id } });
    const { ...orderData } = order as any;
    return {
      ...orderData,
      payment_account: account ? { id: account.id, name: account.name, environment: account.environment } : null,
    };
  }

  async studentGetOrder(session: StudentSessionInfo, orderId: string) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
      include: { invoice: true },
    });
    if (!order || !session.studentIds.includes(order.invoice.student_id)) {
      throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '订单不存在' });
    }
    return order;
  }

  async studentListOrders(session: StudentSessionInfo) {
    return this.prisma.paymentOrder.findMany({
      where: { invoice: { student_id: { in: session.studentIds } } },
      include: { invoice: { select: { id: true, invoice_no: true, fee_period_id: true } } },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
  }

  private genOutTradeNo(): string {
    const d = new Date();
    const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    return `TFS${ts}${this.crypto.randomHex(6).toUpperCase()}`;
  }
}
