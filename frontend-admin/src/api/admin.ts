/** 管理端 API —— 对应 PRD §9.2 / §9.3 */
import { del, get, patch, post } from './client';
import type {
  AdminUser,
  AuditLog,
  Campus,
  CampusFeePrice,
  CollectionStats,
  FeeItem,
  FeePeriod,
  ImportJob,
  Invoice,
  LoginCode,
  LoginCodeBatchResult,
  PageParams,
  PageResult,
  PaymentAccount,
  PaymentOrder,
  Refund,
  Role,
  Student,
} from './types';

export const adminApi = {
  // ---- 登录 ----
  login: (username: string, password: string) =>
    post<{ token: string; user: AdminUser }>('/admin/auth/login', { username, password }),
  logout: () => post<void>('/admin/auth/logout'),

  // ---- 校区 ----
  campuses: (params?: PageParams & { status?: string; keyword?: string }) =>
    get<PageResult<Campus> | Campus[]>('/admin/campuses', { params }),
  createCampus: (data: Partial<Campus>) => post<Campus>('/admin/campuses', data),
  updateCampus: (id: string, data: Partial<Campus>) =>
    patch<Campus>(`/admin/campuses/${id}`, data),

  // ---- 收费期 ----
  feePeriods: (params?: PageParams & { status?: string }) =>
    get<PageResult<FeePeriod> | FeePeriod[]>('/admin/fee-periods', { params }),
  createFeePeriod: (data: Partial<FeePeriod> & { campusIds?: string[] }) =>
    post<FeePeriod>('/admin/fee-periods', data),
  updateFeePeriod: (id: string, data: Partial<FeePeriod>) =>
    patch<FeePeriod>(`/admin/fee-periods/${id}`, data),

  // ---- 学生 ----
  students: (params?: PageParams & { campusId?: string; keyword?: string; status?: string }) =>
    get<PageResult<Student> | Student[]>('/admin/students', { params }),
  createStudent: (data: Partial<Student>) => post<Student>('/admin/students', data),
  updateStudent: (id: string, data: Partial<Student>) =>
    patch<Student>(`/admin/students/${id}`, data),

  // ---- Excel 导入 ----
  createImportJob: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return post<ImportJob>('/admin/import-jobs', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  importJob: (id: string) => get<ImportJob>(`/admin/import-jobs/${id}`),
  commitImport: (id: string) => post<{ imported: number; skipped: number }>(`/admin/import-jobs/${id}/commit`),
  importErrors: (id: string) => get<Blob>(`/admin/import-jobs/${id}/errors`, { responseType: 'blob' }),

  // ---- 登录码 ----
  batchLoginCodes: (studentIds: string[], expiresAt: string) =>
    post<LoginCodeBatchResult>('/admin/login-codes/batch', { studentIds, expiresAt }),
  revokeLoginCode: (id: string) => post<void>(`/admin/login-codes/${id}/revoke`),
  loginCodes: (params?: PageParams & { studentId?: string; status?: string }) =>
    get<PageResult<LoginCode> | LoginCode[]>('/admin/login-codes', { params }),

  // ---- 课程与收费项目 ----
  feeItems: (params?: PageParams & { status?: string; keyword?: string }) =>
    get<PageResult<FeeItem> | FeeItem[]>('/admin/fee-items', { params }),
  createFeeItem: (data: Partial<FeeItem>) => post<FeeItem>('/admin/fee-items', data),
  // PRD §9.2 未列出该 PATCH 端点,按惯例补上;若后端未实现将返回 404,见 README 契约疑问
  updateFeeItem: (id: string, data: Partial<FeeItem>) =>
    patch<FeeItem>(`/admin/fee-items/${id}`, data),
  campusPrices: (params?: { feeItemId?: string; campusId?: string }) =>
    get<CampusFeePrice[]>('/admin/campus-fee-prices', { params }),
  createCampusPrice: (data: Partial<CampusFeePrice>) =>
    post<CampusFeePrice>('/admin/campus-fee-prices', data),

  // ---- 账单 ----
  invoices: (params?: PageParams & { campusId?: string; feePeriodId?: string; status?: string; keyword?: string }) =>
    get<PageResult<Invoice> | Invoice[]>('/admin/invoices', { params }),
  /** 生成账单(单个/批量):返回预览或生成结果 */
  generateInvoices: (data: {
    feePeriodId: string;
    campusId?: string;
    studentIds?: string[];
    preview?: boolean;
  }) =>
    post<{ preview: boolean; count: number; totalFen: number; invoices?: Invoice[] }>(
      '/admin/invoices',
      data,
    ),
  voidInvoice: (id: string, reason: string) =>
    post<void>(`/admin/invoices/${id}/void`, { reason }),

  // ---- 支付订单 ----
  paymentOrders: (
    params?: PageParams & {
      campusId?: string;
      feePeriodId?: string;
      status?: string;
      keyword?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) => get<PageResult<PaymentOrder> | PaymentOrder[]>('/admin/payment-orders', { params }),
  reconcileOrder: (id: string) => post<PaymentOrder>(`/admin/payment-orders/${id}/reconcile`),

  // ---- 退款 ----
  refunds: (params?: PageParams & { status?: string }) =>
    get<PageResult<Refund> | Refund[]>('/admin/refunds', { params }),
  createRefund: (data: { paymentOrderId: string; amountFen: number; reason: string }) =>
    post<Refund>('/admin/refunds', data),
  submitRefund: (id: string) => post<Refund>(`/admin/refunds/${id}/submit`),

  // ---- 报表 ----
  collections: (params?: { campusId?: string; feePeriodId?: string; dateFrom?: string; dateTo?: string }) =>
    get<CollectionStats>('/admin/reports/collections', { params }),
  createExport: (data: { type: string; filters?: Record<string, unknown> }) =>
    post<{ taskId: string }>('/admin/reports/exports', data),

  // ---- 微信支付配置 ----
  // 注意:密钥/私钥文件只走 multipart 上传一次,后端不回显明文
  paymentAccounts: () => get<PaymentAccount[]>('/admin/payment-accounts'),
  createPaymentAccount: (data: Record<string, unknown> | FormData) =>
    data instanceof FormData
      ? post<PaymentAccount>('/admin/payment-accounts', data, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      : post<PaymentAccount>('/admin/payment-accounts', data),
  updatePaymentAccount: (id: string, data: Record<string, unknown> | FormData) =>
    data instanceof FormData
      ? patch<PaymentAccount>(`/admin/payment-accounts/${id}`, data, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      : patch<PaymentAccount>(`/admin/payment-accounts/${id}`, data),
  validatePaymentAccount: (id: string) =>
    post<{ ok: boolean; checks: Array<{ name: string; passed: boolean; message?: string }> }>(
      `/admin/payment-accounts/${id}/validate`,
    ),
  activatePaymentAccount: (id: string) => post<void>(`/admin/payment-accounts/${id}/activate`),
  disablePaymentAccount: (id: string) => post<void>(`/admin/payment-accounts/${id}/disable`),

  // ---- 管理员 / 角色 ----
  adminUsers: (params?: PageParams) => get<PageResult<AdminUser> | AdminUser[]>('/admin/users', { params }),
  createAdminUser: (data: Record<string, unknown>) => post<AdminUser>('/admin/users', data),
  // 后端若未实现该 PATCH 端点则接口将返回 404,见 README 契约疑问
  updateAdminUser: (id: string, data: Record<string, unknown>) =>
    patch<AdminUser>(`/admin/users/${id}`, data),
  roles: () => get<Role[]>('/admin/roles'),
  createRole: (data: Record<string, unknown>) => post<Role>('/admin/roles', data),

  // ---- 审计 ----
  auditLogs: (params?: PageParams & { action?: string; keyword?: string; dateFrom?: string; dateTo?: string }) =>
    get<PageResult<AuditLog> | AuditLog[]>('/admin/audit-logs', { params }),

  // ---- 兼容:后端可能返回分页或裸数组,统一为数组 ----
};

export function toArray<T>(res: PageResult<T> | T[]): T[] {
  return Array.isArray(res) ? res : res.items;
}

export function toPage<T>(res: PageResult<T> | T[], page = 1, pageSize = 20): PageResult<T> {
  if (!Array.isArray(res)) return res;
  return { items: res, total: res.length, page, pageSize };
}

// 删除(部分资源)——按需使用
export const adminDelete = { del };
