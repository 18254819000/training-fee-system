/**
 * 统一 API 客户端(axios)。
 * - baseURL 取 VITE_API_BASE_URL,未配置时回退到 /api/v1(同域代理)
 * - 15s 超时;统一错误格式;requestId 透传便于排错
 * - 认证:学生端优先会话 Cookie(withCredentials),同时兼容 Bearer token;
 *   管理端使用登录后保存的 token。401 时按端跳转登录。
 * - 约定:后端成功响应直接返回业务数据(data 字段或裸数据均兼容)
 */
import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

export interface NormalizedError {
  code: string;
  message: string;
  requestId?: string;
  status?: number;
  raw?: unknown;
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/** 可被 UI 覆盖的 401 处理器(各应用在入口处注册) */
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(fn: () => void) {
  onUnauthorized = fn;
}

/** token 存取(管理端登录用;学生端会话走 Cookie,此处仅作兼容) */
const TOKEN_KEY = 'tfs_auth_token';
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** 绝不在前端存储支付密钥 —— 本客户端只处理会话 token,不涉及任何支付密钥。 */

const baseURL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  '/api/v1';

export const api: AxiosInstance = axios.create({
  baseURL,
  timeout: 15000,
  withCredentials: true, // 学生端会话 Cookie
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  config.headers.set('X-Request-Id', newRequestId());
  const token = getToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

function toFriendlyMessage(status: number | undefined, code: string): string {
  // 不泄露内部信息(SQL/堆栈/密钥),只给可操作的提示
  if (status === 400) return '请求参数有误,请检查后重试';
  if (status === 401) return '登录已过期,请重新登录';
  if (status === 403) return '没有权限执行该操作';
  if (status === 404) return '请求的资源不存在';
  if (status === 409) return '数据冲突,请刷新后重试';
  if (status === 422) return '提交的数据未通过校验';
  if (status === 429) return '操作过于频繁,请稍后再试';
  if (status && status >= 500) return '服务暂时不可用,请稍后再试';
  if (code === 'ECONNABORTED') return '请求超时,请检查网络后重试';
  if (code === 'ERR_NETWORK') return '网络连接失败,请检查网络后重试';
  return '操作失败,请稍后重试';
}

api.interceptors.response.use(
  (resp) => resp,
  (error: AxiosError) => {
    const status = error.response?.status;
    const respData = error.response?.data as
      | { code?: string; message?: string | string[]; requestId?: string }
      | undefined;
    // 后端返回的 message 若包含内部细节则降级为友好提示(简单启发式)
    // 校验错误时 message 为数组，join 为可读字符串
    const rawMsg = Array.isArray(respData?.message)
      ? (respData.message as string[]).join('；')
      : respData?.message;
    const looksInternal =
      !!rawMsg && /(sql|stack|exception|key|secret|password|at\s+[\w$.]+\()/i.test(rawMsg);
    const normalized: NormalizedError = {
      code: respData?.code || error.code || 'UNKNOWN',
      message:
        !looksInternal && rawMsg
          ? rawMsg
          : toFriendlyMessage(status, error.code || ''),
      requestId: respData?.requestId,
      status,
      raw: error,
    };
    if (status === 401 && onUnauthorized) {
      onUnauthorized();
    }
    return Promise.reject(normalized);
  },
);

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const resp = await api.request<unknown>(config);
  const data = resp.data as unknown;
  // 兼容 { code, data, message } 与裸数据两种返回
  if (data && typeof data === 'object' && 'data' in (data as Record<string, unknown>)) {
    return (data as { data: unknown }).data as T;
  }
  return data as T;
}

export const get = <T>(url: string, config?: AxiosRequestConfig) =>
  request<T>({ ...config, method: 'GET', url });
export const post = <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
  request<T>({ ...config, method: 'POST', url, data });
export const patch = <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
  request<T>({ ...config, method: 'PATCH', url, data });
export const del = <T>(url: string, config?: AxiosRequestConfig) =>
  request<T>({ ...config, method: 'DELETE', url });
