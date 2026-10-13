/** 微信 JSAPI 支付封装 —— 对应 PRD §4.8 / §6.2 页面 D */
import type { JsapiPayParams } from '../api/types';

declare global {
  interface Window {
    WeixinJSBridge?: {
      invoke(
        method: 'getBrandWCPayRequest',
        params: Record<string, string>,
        callback: (res: { err_msg: string }) => void,
      ): void;
    };
  }
}

/** 是否在微信内置浏览器中 */
export function isWeChat(): boolean {
  return /micromessenger/i.test(navigator.userAgent);
}

export type JsapiResult = 'ok' | 'cancel' | 'fail';

/**
 * 调起微信收银台。
 * 注意:JSAPI 回调结果仅作体验参考,最终支付状态必须以服务端订单查询/通知为准(PRD §3.3)。
 */
export function invokeJsapiPay(params: JsapiPayParams, timeoutMs = 120000): Promise<JsapiResult> {
  return new Promise((resolve) => {
    const bridge = window.WeixinJSBridge;
    if (!bridge) {
      resolve('fail');
      return;
    }
    let settled = false;
    const done = (r: JsapiResult) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(r);
      }
    };
    // 超时保护:收银台长时间无响应则视为失败,后续靠服务端轮询确认
    const timer = window.setTimeout(() => done('fail'), timeoutMs);
    try {
      bridge.invoke(
        'getBrandWCPayRequest',
        {
          appId: params.appId,
          timeStamp: params.timeStamp,
          nonceStr: params.nonceStr,
          package: params.package,
          signType: params.signType,
          paySign: params.paySign,
        },
        (res) => {
          const msg = res?.err_msg ?? '';
          if (msg === 'get_brand_wcpay_request:ok') done('ok');
          else if (msg === 'get_brand_wcpay_request:cancel') done('cancel');
          else done('fail');
        },
      );
    } catch {
      done('fail');
    }
  });
}
