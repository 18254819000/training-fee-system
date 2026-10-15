import * as crypto from 'crypto';

// 微信支付适配器接口：一期仅 JSAPI
// MockWechatPayAdapter：无真实商户号时保证验收可测（F-13~F-19）
// RealWechatPayAdapter：微信支付 APIv3 真实实现（需配置商户证书/密钥/平台公钥）

export interface JsapiOrderRequest {
  appId: string;
  mchId: string;
  outTradeNo: string;
  amountFen: number;
  description: string;
  notifyUrl: string;
  openid?: string; // JSAPI 真实下单需要付款人 openid（公众号授权获取）
}

export interface JsapiPayParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string; // prepay_id=xxx
  signType: 'RSA';
  paySign: string;
}

export interface OrderQueryResult {
  tradeState: 'SUCCESS' | 'NOTPAY' | 'CLOSED' | 'PAYERROR' | 'UNKNOWN';
  transactionId?: string;
  amountFen?: number;
}

export interface NotifyEvent {
  id: string; // 微信通知 id
  eventType: string;
  summary: string;
  // 解密后的 resource
  outTradeNo: string;
  outRefundNo?: string;
  transactionId?: string;
  refundId?: string;
  tradeState?: string;
  refundStatus?: string;
  amountFen?: number;
  mchId?: string;
  appId?: string;
}

export interface RefundRequest {
  appId: string;
  mchId: string;
  outTradeNo: string;
  outRefundNo: string;
  totalFen: number;
  refundFen: number;
  reason: string;
  notifyUrl?: string;
}

export interface AdapterContext {
  privateKeyPem: string;
  certSerial: string;
  apiv3Key: string; // 32 字节
  platformPublicKeyPem: string; // 平台公钥（验签通知用）
}

export interface WechatPayAdapter {
  readonly name: string;
  createJsapiOrder(req: JsapiOrderRequest, ctx: AdapterContext): Promise<{ prepayId: string; jsapiParams: JsapiPayParams }>;
  queryOrder(outTradeNo: string, mchId: string, ctx: AdapterContext): Promise<OrderQueryResult>;
  /** 验签 + 解密通知；返回 null 表示验签失败 */
  verifyNotify(headers: Record<string, string | undefined>, rawBody: Buffer, ctx: AdapterContext): Promise<NotifyEvent | null>;
  createRefund(req: RefundRequest, ctx: AdapterContext): Promise<{ refundId: string; status: string }>;
  queryRefund(outRefundNo: string, mchId: string, ctx: AdapterContext): Promise<{ status: string }>;
}

// ─── Mock 适配器 ───

export class MockWechatPayAdapter implements WechatPayAdapter {
  readonly name = 'mock';
  // 内存状态：out_trade_no -> tradeState（simulate 接口可翻转）
  private orderStates = new Map<string, 'NOTPAY' | 'SUCCESS'>();
  private refundStates = new Map<string, 'PROCESSING' | 'SUCCESS'>();

  async createJsapiOrder(req: JsapiOrderRequest) {
    const prepayId = `mock_prepay_${req.outTradeNo}`;
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = crypto.randomBytes(16).toString('hex');
    this.orderStates.set(req.outTradeNo, 'NOTPAY');
    return {
      prepayId,
      jsapiParams: {
        appId: req.appId,
        timeStamp,
        nonceStr,
        package: `prepay_id=${prepayId}`,
        signType: 'RSA' as const,
        // Mock 签名：明示为测试值，前端/验收可识别
        paySign: `MOCK_SIGN_${nonceStr.slice(0, 16)}`,
      },
    };
  }

  async queryOrder(outTradeNo: string): Promise<OrderQueryResult> {
    const s = this.orderStates.get(outTradeNo) || 'NOTPAY';
    return {
      tradeState: s === 'SUCCESS' ? 'SUCCESS' : 'NOTPAY',
      transactionId: s === 'SUCCESS' ? `mock_txn_${outTradeNo}` : undefined,
    };
  }

  /** Mock 验签：要求 x-mock-notify: 1 请求头，body 为明文 JSON（测试可控） */
  async verifyNotify(
    headers: Record<string, string | undefined>, rawBody: Buffer,
  ): Promise<NotifyEvent | null> {
    if (headers['x-mock-notify'] !== '1') return null;
    try {
      const body = JSON.parse(rawBody.toString('utf8'));
      if (!body.out_trade_no || !body.notification_id) return null;
      return {
        id: String(body.notification_id),
        eventType: body.event_type || 'TRANSACTION.SUCCESS',
        summary: 'Mock 支付通知',
        outTradeNo: String(body.out_trade_no),
        transactionId: body.transaction_id || `mock_txn_${body.out_trade_no}`,
        tradeState: body.trade_state || 'SUCCESS',
        amountFen: body.amount_fen,
        mchId: body.mch_id,
        appId: body.app_id,
      };
    } catch {
      return null;
    }
  }

  /** 测试用：翻转订单为已支付并返回可直接喂给 notify 的报文 */
  simulatePaid(outTradeNo: string, amountFen: number, mchId: string, appId: string) {
    this.orderStates.set(outTradeNo, 'SUCCESS');
    const body = {
      notification_id: `mock_notif_${outTradeNo}_${Date.now()}`,
      event_type: 'TRANSACTION.SUCCESS',
      out_trade_no: outTradeNo,
      transaction_id: `mock_txn_${outTradeNo}`,
      trade_state: 'SUCCESS',
      amount_fen: amountFen,
      mch_id: mchId,
      app_id: appId,
    };
    return { headers: { 'x-mock-notify': '1' }, rawBody: Buffer.from(JSON.stringify(body)) };
  }

  async createRefund(req: RefundRequest) {
    const refundId = `mock_rf_${req.outRefundNo}`;
    this.refundStates.set(req.outRefundNo, 'SUCCESS'); // Mock 直接成功，便于验收
    return { refundId, status: 'SUCCESS' };
  }

  async queryRefund(outRefundNo: string, _mchId: string) {
    return { status: this.refundStates.get(outRefundNo) || 'PROCESSING' };
  }
}

// ─── 真实适配器（微信支付 APIv3） ───

const API_BASE = 'https://api.mch.weixin.qq.com';

export class RealWechatPayAdapter implements WechatPayAdapter {
  readonly name = 'real';

  private buildAuthorization(mchId: string, serialNo: string, privateKeyPem: string, method: string, url: string, body: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    // 微信支付 APIv3 签名串顺序：HTTP方法\nURL\n时间戳\n随机串\n报文主体\n
    const message = `${method}\n${url}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = crypto.sign('sha256', Buffer.from(message, 'utf8'), privateKeyPem).toString('base64');
    return `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
  }

  private async api(method: string, path: string, mchId: string, ctx: AdapterContext, body?: any) {
    const bodyStr = body ? JSON.stringify(body) : '';
    const auth = this.buildAuthorization(mchId, ctx.certSerial, ctx.privateKeyPem, method, path, bodyStr);
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: bodyStr || undefined,
    });
    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* 非 JSON 响应 */ }
    if (!res.ok) {
      throw new Error(`微信支付 API 错误 ${res.status}: ${json.message || text.slice(0, 300)}`);
    }
    return json;
  }

  async createJsapiOrder(req: JsapiOrderRequest, ctx: AdapterContext) {
    if (!req.openid) {
      throw new Error('JSAPI 下单需要付款人 openid（需先完成公众号网页授权）；Mock 模式可跳过');
    }
    const json = await this.api('POST', '/v3/pay/transactions/jsapi', req.mchId, ctx, {
      appid: req.appId,
      mchid: req.mchId,
      description: req.description.slice(0, 127),
      out_trade_no: req.outTradeNo,
      notify_url: req.notifyUrl,
      amount: { total: req.amountFen, currency: 'CNY' },
      payer: { openid: req.openid },
    });
    const prepayId = json.prepay_id as string;
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const pkg = `prepay_id=${prepayId}`;
    const message = `${req.appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
    const paySign = crypto.sign('sha256', Buffer.from(message, 'utf8'), ctx.privateKeyPem).toString('base64');
    return {
      prepayId,
      jsapiParams: { appId: req.appId, timeStamp, nonceStr, package: pkg, signType: 'RSA' as const, paySign },
    };
  }

  async queryOrder(outTradeNo: string, mchId: string, ctx: AdapterContext): Promise<OrderQueryResult> {    const path = `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${mchId}`;
    const json = await this.api('GET', path, mchId, ctx);
    const state = String(json.trade_state || 'UNKNOWN');
    const map: Record<string, OrderQueryResult['tradeState']> = {
      SUCCESS: 'SUCCESS', NOTPAY: 'NOTPAY', CLOSED: 'CLOSED', PAYERROR: 'PAYERROR',
    };
    return {
      tradeState: map[state] || 'UNKNOWN',
      transactionId: json.transaction_id,
      amountFen: json.amount?.payer_total,    };
  }

  /** 拉取微信支付平台证书列表（GET /v3/certificates），用于启用前自检 */
  async fetchPlatformCertificates(mchId: string, ctx: AdapterContext): Promise<Array<{ serial_no: string; effective_time: string; expire_time: string }>> {
    const json = await this.api('GET', '/v3/certificates', mchId, ctx);
    const data = Array.isArray(json.data) ? json.data : [];
    return data.map((c: any) => ({
      serial_no: String(c.serial_no || ''),
      effective_time: String(c.effective_time || ''),
      expire_time: String(c.expire_time || ''),
    }));
  }

  async verifyNotify(
    headers: Record<string, string | undefined>, rawBody: Buffer, ctx: AdapterContext,
  ): Promise<NotifyEvent | null> {
    const signature = headers['wechatpay-signature'];
    const timestamp = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    if (!signature || !timestamp || !nonce) return null;
    // 5 分钟有效期（防重放）
    if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return null;
    const message = `${timestamp}\n${nonce}\n${rawBody.toString('utf8')}\n`;
    let ok = false;
    try {
      ok = crypto.verify('sha256', Buffer.from(message, 'utf8'), ctx.platformPublicKeyPem, Buffer.from(signature, 'base64'));
    } catch {
      return null;
    }
    if (!ok) return null;

    const body = JSON.parse(rawBody.toString('utf8'));
    const resource = body.resource;
    if (!resource?.ciphertext) return null;
    // AEAD_AES_256_GCM 解密
    const key = Buffer.from(ctx.apiv3Key, 'utf8');
    if (key.length !== 32) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
    decipher.setAuthTag(Buffer.from(resource.ciphertext, 'base64').subarray(-16));
    const aad = resource.associated_data ? Buffer.from(resource.associated_data, 'utf8') : undefined;
    if (aad) decipher.setAAD(aad);
    const ct = Buffer.from(resource.ciphertext, 'base64').subarray(0, -16);
    let plain: any;
    try {
      plain = JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'));
    } catch {
      return null;
    }
    const eventType = String(body.event_type || '');
    const isRefund = eventType.startsWith('REFUND');
    return {
      id: String(body.id),
      eventType,
      summary: String(body.summary || ''),
      outTradeNo: String(plain.out_trade_no || ''),
      outRefundNo: plain.out_refund_no ? String(plain.out_refund_no) : undefined,
      transactionId: plain.transaction_id ? String(plain.transaction_id) : undefined,
      refundId: plain.refund_id ? String(plain.refund_id) : undefined,
      tradeState: plain.trade_state ? String(plain.trade_state) : undefined,
      refundStatus: plain.refund_status ? String(plain.refund_status) : undefined,
      amountFen: isRefund ? plain.amount?.refund : plain.amount?.payer_total,
      mchId: plain.mchid ? String(plain.mchid) : undefined,
      appId: plain.appid ? String(plain.appid) : undefined,
    };
  }

  async createRefund(req: RefundRequest, ctx: AdapterContext) {
    const json = await this.api('POST', '/v3/refund/domestic/refunds', req.mchId, ctx, {
      out_trade_no: req.outTradeNo,
      out_refund_no: req.outRefundNo,
      reason: req.reason.slice(0, 80),
      notify_url: req.notifyUrl,
      amount: { refund: req.refundFen, total: req.totalFen, currency: 'CNY' },
    });
    return { refundId: String(json.refund_id), status: String(json.status || 'PROCESSING') };
  }

  async queryRefund(outRefundNo: string, mchId: string, ctx: AdapterContext) {
    const path = `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`;
    const json = await this.api('GET', path, mchId, ctx);
    return { status: String(json.status || 'UNKNOWN') };
  }

  async queryRefundWithMchid(outRefundNo: string, mchId: string, ctx: AdapterContext) {
    const json = await this.api('GET', `/v3/refund/domestic/refunds/${outRefundNo}`, mchId, ctx);
    return { status: String(json.status || 'PROCESSING') };
  }
}
