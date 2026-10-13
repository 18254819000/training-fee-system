/**
 * 共享类型定义 —— 与 PRD §8 数据库设计、§9 API 清单对齐。
 * 金额一律为"分"(整数)；时间字段为 ISO 8601 字符串(后端统一 UTC)。
 */

// ---------- 通用 ----------
export interface ApiErrorShape {
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
}

export interface PageParams {
  page?: number;
  pageSize?: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------- 校区 ----------
export type CampusStatus = 'active' | 'inactive';

export interface Campus {
  id: string;
  code: string;
  name: string;
  address?: string;
  contactName?: string;
  contactPhone?: string;
  status: CampusStatus;
  createdAt: string;
  updatedAt: string;
}

// ---------- 收费期 ----------
export type FeePeriodStatus = 'draft' | 'open' | 'closed';

export interface FeePeriod {
  id: string;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  status: FeePeriodStatus;
  campusIds?: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------- 学生 ----------
export type StudentStatus = 'active' | 'inactive' | 'left';

export interface Student {
  id: string;
  studentNo?: string;
  /** 后端返回时可能已脱敏(如"张*明") */
  name: string;
  campusId: string;
  campusName?: string;
  gradeOrClass?: string;
  status: StudentStatus;
  createdAt: string;
  updatedAt: string;
}

// ---------- 登录码 ----------
export type LoginCodeStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface LoginCode {
  id: string;
  studentId: string;
  studentName?: string;
  status: LoginCodeStatus;
  expiresAt: string;
  usedAt?: string;
  failedAttempts: number;
  createdAt: string;
}

export interface LoginCodeBatchResult {
  jobId: string;
  total: number;
  /** 明文码仅签发时返回一次,前端用于打印 */
  codes?: Array<{ studentId: string; studentName: string; code: string; expiresAt: string }>;
}

// ---------- 课程与收费项目 ----------
export interface FeeItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface CampusFeePrice {
  id: string;
  feeItemId: string;
  feeItemName?: string;
  campusId: string;
  campusName?: string;
  /** 分 */
  amountFen: number;
  effectiveFrom: string;
  effectiveTo?: string;
  createdAt: string;
}

// ---------- 账单 ----------
export type InvoiceStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'refunding'
  | 'refunded'
  | 'voided';

export interface InvoiceItem {
  feeItemId?: string;
  itemNameSnapshot: string;
  unitPriceFen: number;
  quantity: number;
  lineAmountFen: number;
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  studentId: string;
  studentName?: string;
  campusId: string;
  campusName?: string;
  feePeriodId: string;
  feePeriodName?: string;
  items: InvoiceItem[];
  amountDueFen: number;
  amountPaidFen: number;
  amountRefundedFen: number;
  status: InvoiceStatus;
  createdAt: string;
  updatedAt: string;
}

// ---------- 支付订单 ----------
export type PaymentOrderStatus = 'created' | 'pending' | 'paid' | 'failed' | 'closed';

export interface PaymentOrder {
  id: string;
  outTradeNo: string;
  invoiceId: string;
  invoiceNo?: string;
  paymentAccountId?: string;
  channel: 'WECHAT';
  amountFen: number;
  status: PaymentOrderStatus;
  wechatTransactionId?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** 微信 JSAPI 调起参数(服务端返回,前端直接透传给 WeixinJSBridge) */
export interface JsapiPayParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

export interface CreatePaymentResp {
  order: PaymentOrder;
  jsapiParams: JsapiPayParams;
}

// ---------- 退款 ----------
export type RefundStatus =
  | 'applying'
  | 'approved'
  | 'submitting'
  | 'processing'
  | 'success'
  | 'failed'
  | 'closed';

export interface Refund {
  id: string;
  refundNo: string;
  paymentOrderId: string;
  outTradeNo?: string;
  amountFen: number;
  reason: string;
  status: RefundStatus;
  wechatRefundId?: string;
  requestedBy?: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- 微信支付账户配置 ----------
export type PaymentAccountStatus = 'draft' | 'testing' | 'active' | 'disabled';
export type PaymentAccountEnv = 'test' | 'production';

export interface PaymentAccount {
  id: string;
  name: string;
  environment: PaymentAccountEnv;
  appId: string;
  mchId: string;
  merchantCertSerial?: string;
  /** 是否已配置私钥/证书/APIv3密钥(仅布尔,不回显) */
  privateKeyConfigured: boolean;
  apiv3SecretConfigured: boolean;
  platformKeyConfigured: boolean;
  notifyUrl: string;
  scopeType: 'all' | 'campuses';
  campusIds?: string[];
  status: PaymentAccountStatus;
  remark?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- 管理员 / 角色 / 审计 ----------
export interface AdminUser {
  id: string;
  username: string;
  status: 'active' | 'disabled';
  roles: string[];
  campusIds: string[];
  lastLoginAt?: string;
  createdAt: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  permissions: string[];
}

export interface AuditLog {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  result: string;
  requestId?: string;
  createdAt: string;
}

// ---------- 报表 ----------
export interface CollectionStats {
  /** 应收(分) */
  receivableFen: number;
  /** 实收(分) */
  receivedFen: number;
  /** 待收(分) */
  pendingFen: number;
  /** 退款(分) */
  refundedFen: number;
  orderCount: number;
  paidOrderCount: number;
  refundCount: number;
}

export interface ImportJob {
  id: string;
  fileName: string;
  status: 'uploaded' | 'validating' | 'preview' | 'committing' | 'done' | 'failed';
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors?: Array<{ row: number; field?: string; message: string }>;
  createdAt: string;
}

// ---------- 学生端会话 ----------
export interface MeStudent {
  id: string;
  /** 脱敏姓名 */
  name: string;
  campusName?: string;
  gradeOrClass?: string;
}

export interface MeFeePeriod {
  id: string;
  name: string;
  status: FeePeriodStatus;
}
