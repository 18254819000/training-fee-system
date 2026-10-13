/** 格式化工具:金额 / 时间 / 脱敏 —— 全局统一口径(PRD §6.4) */

/** 分 -> 元字符串,保留两位小数 */
export function fenToYuan(fen: number | undefined | null): string {
  if (fen === undefined || fen === null || Number.isNaN(fen)) return '0.00';
  return (fen / 100).toFixed(2);
}

/** 分 -> 带千分位的元字符串 */
export function fenToYuanGrouped(fen: number | undefined | null): string {
  if (fen === undefined || fen === null || Number.isNaN(fen)) return '0.00';
  return (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 时间按 Asia/Shanghai 展示: YYYY-MM-DD HH:mm */
export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** 日期: YYYY-MM-DD */
export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 姓名脱敏:保留首尾,中间用 * (如"张*明";单字名返回"*" ) */
export function maskName(name: string | undefined | null): string {
  if (!name) return '-';
  const chars = Array.from(name.trim());
  if (chars.length <= 1) return '*';
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

/** 手机号脱敏: 138****8000 */
export function maskPhone(phone: string | undefined | null): string {
  if (!phone) return '-';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return '****';
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

// ---------- 状态文案 ----------

export const INVOICE_STATUS_TEXT: Record<string, string> = {
  pending: '待支付',
  processing: '支付处理中',
  paid: '已支付',
  refunding: '退款处理中',
  refunded: '已退款',
  voided: '已作废',
};

export const ORDER_STATUS_TEXT: Record<string, string> = {
  created: '已创建',
  pending: '待支付',
  paid: '已支付',
  failed: '失败',
  closed: '已关闭',
};

export const REFUND_STATUS_TEXT: Record<string, string> = {
  applying: '申请中',
  approved: '已批准',
  submitting: '提交中',
  processing: '处理中',
  success: '退款成功',
  failed: '退款失败',
  closed: '已关闭',
};

export const PERIOD_STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  open: '开放中',
  closed: '已结束',
};

export const CAMPUS_STATUS_TEXT: Record<string, string> = {
  active: '启用',
  inactive: '停用',
};

export const ACCOUNT_STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  testing: '待测试',
  active: '已启用',
  disabled: '已停用',
};

export const LOGIN_CODE_STATUS_TEXT: Record<string, string> = {
  active: '有效',
  used: '已使用',
  expired: '已过期',
  revoked: '已撤销',
};

export function statusText(map: Record<string, string>, value: string | undefined): string {
  if (!value) return '-';
  return map[value] ?? value;
}
