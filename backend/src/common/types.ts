// 跨模块共享的认证上下文类型
export interface AdminUserInfo {
  id: string;
  username: string;
  roles: string[]; // 如 ['super_admin']
  permissions: string[]; // 如 ['invoice:read']，super_admin 为 ['*']
  campusIds: string[]; // 校区管理员/操作员的可管校区；超管/财务为空数组表示全部
}

export interface StudentSessionInfo {
  id: string;
  studentIds: string[];
  guardianId: string | null;
}

// 角色编码（与 seed/DB roles.code 一致）
export const ROLE_CODES = {
  SUPER_ADMIN: 'super_admin',
  FINANCE: 'finance',
  CAMPUS_ADMIN: 'campus_admin',
  OPERATOR: 'operator',
} as const;

// 权限编码
export const PERM = {
  CAMPUS_READ: 'campus:read',
  CAMPUS_WRITE: 'campus:write',
  FEE_PERIOD_READ: 'fee-period:read',
  FEE_PERIOD_WRITE: 'fee-period:write',
  STUDENT_READ: 'student:read',
  STUDENT_WRITE: 'student:write',
  STUDENT_IMPORT: 'student:import',
  LOGIN_CODE_MANAGE: 'login-code:manage',
  FEE_ITEM_READ: 'fee-item:read',
  FEE_ITEM_WRITE: 'fee-item:write',
  INVOICE_READ: 'invoice:read',
  INVOICE_GENERATE: 'invoice:generate',
  INVOICE_VOID: 'invoice:void',
  PAYMENT_READ: 'payment:read',
  PAYMENT_RECONCILE: 'payment:reconcile',
  REFUND_APPLY: 'refund:apply',
  REFUND_SUBMIT: 'refund:submit',
  REPORT_READ: 'report:read',
  EXPORT: 'export',
  PAYMENT_ACCOUNT_READ: 'payment-account:read',
  PAYMENT_ACCOUNT_MANAGE: 'payment-account:manage',
  ADMIN_USER_MANAGE: 'admin-user:manage',
  AUDIT_READ: 'audit:read',
} as const;
