/** 学生端 API —— 对应 PRD §9.1 */
import { get, post } from './client';
import type {
  CreatePaymentResp,
  Invoice,
  JsapiPayParams,
  MeFeePeriod,
  MeStudent,
  PaymentOrder,
  Refund,
} from './types';

export const studentApi = {
  /** 验证登录码(第一步) */
  exchangeCode: (code: string) =>
    post<{ exchangeToken: string; student: MeStudent; needConfirm?: boolean }>(
      '/auth/code/exchange',
      { code },
    ),
  /** 确认绑定并建立正式会话(第二步) */
  bind: (exchangeToken: string) =>
    post<{ student: MeStudent }>('/auth/bind', { exchangeToken }),
  logout: () => post<void>('/auth/logout'),

  meStudents: () => get<MeStudent[]>('/me/students'),
  meFeePeriods: (studentId?: string) =>
    get<MeFeePeriod[]>('/me/fee-periods', { params: studentId ? { studentId } : undefined }),
  invoices: (params?: { studentId?: string; feePeriodId?: string }) =>
    get<Invoice[]>('/me/invoices', { params }),
  invoiceDetail: (id: string) => get<Invoice>(`/me/invoices/${id}`),

  /** 创建支付订单并获取 JSAPI 参数 */
  createPayment: (invoiceId: string, idempotencyKey: string) =>
    post<CreatePaymentResp>(
      '/me/payments',
      { invoiceId },
      { headers: { 'X-Idempotency-Key': idempotencyKey } },
    ),
  paymentStatus: (id: string) => get<PaymentOrder>(`/me/payments/${id}`),
  paymentHistory: () => get<PaymentOrder[]>('/me/payment-history'),
  myRefunds: () => get<Refund[]>('/me/refunds'),
};

export type { JsapiPayParams };
