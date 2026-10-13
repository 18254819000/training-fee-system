<script setup lang="ts">
/** 页面 D:确认支付 —— PRD §6.2
 * 流程:展示订单摘要 → 服务端创建订单(幂等键)→ 返回 JSAPI 参数 →
 * 非微信环境给明确引导 → 调起收银台 → 无论 JSAPI 回调如何,都跳转结果页轮询服务端状态
 */
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Button as VanButton,
  Cell as VanCell,
  CellGroup as VanCellGroup,
  Dialog as VanDialog,
  Empty as VanEmpty,
  Loading as VanLoading,
  NavBar as VanNavBar,
  showToast,
} from 'vant';
import { studentApi } from '../api/student';
import { fenToYuan, formatDateTime } from '../utils/format';
import { invokeJsapiPay, isWeChat } from '../utils/wechat';
import type { Invoice } from '../api/types';
import type { NormalizedError } from '../api/client';

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const loadError = ref(false);
const invoice = ref<Invoice | null>(null);
const paying = ref(false);
const inWeChat = isWeChat();
/** 幂等键:一次确认支付流程内固定,防重复点击产生重复订单 */
const idempotencyKey =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pay-${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    invoice.value = await studentApi.invoiceDetail(route.params.invoiceId as string);
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

async function handlePay() {
  if (!invoice.value || paying.value) return;
  if (!inWeChat) {
    await VanDialog.alert({
      title: '请在微信中打开',
      message: '微信支付需要在微信内置浏览器中完成。请复制链接到微信中打开,或让老师重新发送缴费链接。',
    });
    return;
  }
  paying.value = true;
  try {
    // 1) 服务端创建订单并返回 JSAPI 参数(金额以后端账单为准)
    const { order, jsapiParams } = await studentApi.createPayment(invoice.value.id, idempotencyKey);
    // 2) 调起微信收银台
    const result = await invokeJsapiPay(jsapiParams);
    if (result === 'cancel') {
      showToast('已取消支付');
      paying.value = false;
      return;
    }
    // 3) 无论 JSAPI 回调成功/失败/超时,都以后端轮询结果为准(PRD §3.3)
    await router.replace({ name: 'pay-result', params: { orderId: order.id } });
  } catch (err) {
    const e = err as NormalizedError;
    showToast(e?.message || '创建支付订单失败,请重试');
    paying.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <VanNavBar title="确认支付" left-arrow @click-left="router.back()" />

    <div v-if="loading" class="empty-wrap"><VanLoading />正在加载…</div>
    <div v-else-if="loadError || !invoice" class="empty-wrap">
      <VanEmpty description="账单加载失败">
        <VanButton plain type="primary" size="small" @click="load">重新加载</VanButton>
      </VanEmpty>
    </div>
    <template v-else>
      <div class="card">
        <div class="row-between">
          <span class="muted">账单号</span>
          <span>{{ invoice.invoiceNo }}</span>
        </div>
        <div class="row-between kv">
          <span class="muted">收费期</span>
          <span>{{ invoice.feePeriodName || '-' }}</span>
        </div>
        <div class="row-between total">
          <span>应付金额</span>
          <span class="amount large">¥{{ fenToYuan(invoice.amountDueFen - invoice.amountPaidFen) }}</span>
        </div>
      </div>

      <VanCellGroup inset title="明细">
        <VanCell
          v-for="(item, idx) in invoice.items"
          :key="idx"
          :title="item.itemNameSnapshot"
          :value="`¥${fenToYuan(item.lineAmountFen)}`"
        />
      </VanCellGroup>

      <div class="card">
        <VanCellGroup :border="false">
          <VanCell title="支付方式" value="微信支付" />
        </VanCellGroup>
        <VanButton
          type="primary"
          block
          :loading="paying"
          loading-text="正在调起微信支付…"
          :disabled="invoice.status !== 'pending'"
          @click="handlePay"
        >
          确认支付
        </VanButton>
        <p v-if="!inWeChat" class="muted hint warn">
          当前不在微信内置浏览器中,无法调起微信支付,请在微信中打开本页面
        </p>
        <p v-else class="muted hint">支付结果以学校系统确认的订单状态为准</p>
        <p class="muted hint">生成时间 {{ formatDateTime(invoice.createdAt) }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.kv {
  margin-top: 10px;
}
.total {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #ebedf0;
  font-weight: 600;
}
.hint {
  margin-top: 10px;
  text-align: center;
}
.warn {
  color: #ee0a24;
}
</style>
