<script setup lang="ts">
/** 历史缴费查询 —— PRD §9.1 /me/payment-history、/me/refunds */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  Button as VanButton,
  Cell as VanCell,
  CellGroup as VanCellGroup,
  Empty as VanEmpty,
  Loading as VanLoading,
  NavBar as VanNavBar,
  Tab as VanTab,
  Tabs as VanTabs,
} from 'vant';
import { studentApi } from '../api/student';
import {
  fenToYuan,
  formatDateTime,
  ORDER_STATUS_TEXT,
  REFUND_STATUS_TEXT,
  statusText,
} from '../utils/format';
import type { PaymentOrder, Refund } from '../api/types';

const router = useRouter();

const loading = ref(true);
const orders = ref<PaymentOrder[]>([]);
const refunds = ref<Refund[]>([]);
const activeTab = ref(0);

async function load() {
  loading.value = true;
  try {
    const [o, r] = await Promise.all([studentApi.paymentHistory(), studentApi.myRefunds()]);
    orders.value = o;
    refunds.value = r;
  } catch {
    orders.value = [];
    refunds.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <VanNavBar title="历史缴费查询" left-arrow @click-left="router.back()" />

    <div v-if="loading" class="empty-wrap"><VanLoading />正在加载…</div>
    <template v-else>
      <VanTabs v-model:active="activeTab">
        <VanTab title="缴费记录">
          <VanCellGroup v-if="orders.length > 0" inset>
            <VanCell
              v-for="o in orders"
              :key="o.id"
              :title="o.outTradeNo"
              :label="`${statusText(ORDER_STATUS_TEXT, o.status)} · ${formatDateTime(o.createdAt)}`"
              :value="`¥${fenToYuan(o.amountFen)}`"
            />
          </VanCellGroup>
          <VanEmpty v-else description="暂无缴费记录" />
        </VanTab>
        <VanTab title="退款记录">
          <VanCellGroup v-if="refunds.length > 0" inset>
            <VanCell
              v-for="r in refunds"
              :key="r.id"
              :title="r.refundNo"
              :label="`${statusText(REFUND_STATUS_TEXT, r.status)} · ${r.reason || ''} · ${formatDateTime(r.createdAt)}`"
              :value="`¥${fenToYuan(r.amountFen)}`"
            />
          </VanCellGroup>
          <VanEmpty v-else description="暂无退款记录" />
        </VanTab>
      </VanTabs>
      <div class="card">
        <VanButton block plain @click="load">刷新</VanButton>
      </div>
    </template>
  </div>
</template>
