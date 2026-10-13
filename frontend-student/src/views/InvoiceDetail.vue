<script setup lang="ts">
/** 页面 C:账单详情 —— PRD §6.2 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Button as VanButton,
  Cell as VanCell,
  CellGroup as VanCellGroup,
  Empty as VanEmpty,
  Loading as VanLoading,
  NavBar as VanNavBar,
} from 'vant';
import { studentApi } from '../api/student';
import {
  fenToYuan,
  formatDateTime,
  INVOICE_STATUS_TEXT,
  statusText,
} from '../utils/format';
import type { Invoice } from '../api/types';

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const loadError = ref(false);
const invoice = ref<Invoice | null>(null);

const unpaidFen = computed(() =>
  invoice.value ? invoice.value.amountDueFen - invoice.value.amountPaidFen : 0,
);
/** 已支付/处理中/已作废的账单禁用重复支付(PRD §6.2) */
const canPay = computed(() => invoice.value?.status === 'pending' && unpaidFen.value > 0);
const payHint = computed(() => {
  if (!invoice.value) return '';
  switch (invoice.value.status) {
    case 'paid':
      return '该账单已支付,无需重复缴费';
    case 'processing':
      return '该账单正在支付处理中,请稍后查询状态';
    case 'refunding':
    case 'refunded':
      return '该账单正在退款/已退款';
    case 'voided':
      return '该账单已作废';
    default:
      return '';
  }
});

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    invoice.value = await studentApi.invoiceDetail(route.params.id as string);
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

function goPay() {
  if (!invoice.value || !canPay.value) return;
  router.push({ name: 'confirm-pay', params: { invoiceId: invoice.value.id } });
}

onMounted(load);
</script>

<template>
  <div class="page">
    <VanNavBar title="账单详情" left-arrow @click-left="router.back()" />

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
        <div class="row-between kv">
          <span class="muted">状态</span>
          <span>{{ statusText(INVOICE_STATUS_TEXT, invoice.status) }}</span>
        </div>
        <div class="row-between kv">
          <span class="muted">生成时间</span>
          <span>{{ formatDateTime(invoice.createdAt) }}</span>
        </div>
      </div>

      <VanCellGroup inset title="收费项目">
        <VanCell
          v-for="(item, idx) in invoice.items"
          :key="idx"
          :title="item.itemNameSnapshot"
          :label="`单价 ¥${fenToYuan(item.unitPriceFen)} × ${item.quantity}`"
          :value="`¥${fenToYuan(item.lineAmountFen)}`"
        />
      </VanCellGroup>

      <div class="card">
        <div class="row-between kv">
          <span class="muted">应收金额</span>
          <span class="amount">¥{{ fenToYuan(invoice.amountDueFen) }}</span>
        </div>
        <div class="row-between kv">
          <span class="muted">已付金额</span>
          <span class="amount">¥{{ fenToYuan(invoice.amountPaidFen) }}</span>
        </div>
        <div class="row-between total">
          <span>待付金额</span>
          <span class="amount large">¥{{ fenToYuan(unpaidFen) }}</span>
        </div>
      </div>

      <div class="card">
        <VanButton type="primary" block :disabled="!canPay" @click="goPay">
          {{ canPay ? `去支付 ¥${fenToYuan(unpaidFen)}` : '不可支付' }}
        </VanButton>
        <p v-if="payHint" class="muted hint">{{ payHint }}</p>
        <p v-else class="muted hint">点击支付将跳转到微信收银台完成缴费</p>
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
</style>
