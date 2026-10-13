<script setup lang="ts">
/** 页面 B:学生与收费期首页 —— PRD §6.2 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  Button as VanButton,
  Cell as VanCell,
  CellGroup as VanCellGroup,
  Empty as VanEmpty,
  Loading as VanLoading,
  showToast,
} from 'vant';
import { studentApi } from '../api/student';
import {
  fenToYuan,
  formatDate,
  INVOICE_STATUS_TEXT,
  maskName,
  statusText,
} from '../utils/format';
import type { Invoice, MeFeePeriod } from '../api/types';
import { useSessionStore } from '../stores/session';

const router = useRouter();
const session = useSessionStore();

const loading = ref(true);
const loadError = ref(false);
const periods = ref<MeFeePeriod[]>([]);
const invoices = ref<Invoice[]>([]);
const activePeriodId = ref<string>('');

const studentName = computed(() => maskName(session.student?.name));

const periodInvoices = computed(() =>
  invoices.value.filter((i) => !activePeriodId.value || i.feePeriodId === activePeriodId.value),
);

const totalPaid = computed(() => periodInvoices.value.reduce((s, i) => s + i.amountPaidFen, 0));
const totalUnpaid = computed(() =>
  periodInvoices.value
    .filter((i) => i.status === 'pending' || i.status === 'processing')
    .reduce((s, i) => s + (i.amountDueFen - i.amountPaidFen), 0),
);

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    const [p, inv] = await Promise.all([studentApi.meFeePeriods(), studentApi.invoices()]);
    periods.value = p;
    invoices.value = inv;
    const open = p.find((x) => x.status === 'open');
    if (open) activePeriodId.value = open.id;
    else if (p.length > 0) activePeriodId.value = p[0].id;
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

function goInvoice(id: string) {
  router.push({ name: 'invoice-detail', params: { id } });
}

async function handleLogout() {
  await session.logout();
  showToast('已退出登录');
  await router.replace('/login');
}

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="brand-header">
      <h1>{{ studentName }}同学,你好</h1>
      <p>{{ session.student?.campusName || '' }}</p>
    </div>

    <div v-if="loading" class="empty-wrap"><VanLoading />正在加载…</div>
    <div v-else-if="loadError" class="empty-wrap">
      <p>加载失败,请检查网络后重试</p>
      <VanButton plain type="primary" size="small" @click="load">重新加载</VanButton>
    </div>
    <template v-else>
      <div class="card summary">
        <div class="row-between">
          <span class="muted">待缴金额</span>
          <span class="muted">已缴金额</span>
        </div>
        <div class="row-between">
          <span class="amount large">¥{{ fenToYuan(totalUnpaid) }}</span>
          <span class="amount">¥{{ fenToYuan(totalPaid) }}</span>
        </div>
      </div>

      <div v-if="periods.length > 1" class="card">
        <div class="muted" style="margin-bottom: 8px">收费期</div>
        <div class="period-tabs">
          <VanButton
            v-for="p in periods"
            :key="p.id"
            size="small"
            :type="p.id === activePeriodId ? 'primary' : 'default'"
            @click="activePeriodId = p.id"
          >
            {{ p.name }}
          </VanButton>
        </div>
      </div>

      <VanCellGroup v-if="periodInvoices.length > 0" inset title="我的账单">
        <VanCell
          v-for="inv in periodInvoices"
          :key="inv.id"
          :title="inv.invoiceNo"
          :label="`${inv.feePeriodName || ''} · ${formatDate(inv.createdAt)}`"
          :value="`¥${fenToYuan(inv.amountDueFen - inv.amountPaidFen)}`"
          is-link
          @click="goInvoice(inv.id)"
        >
          <template #title>
            <span>{{ inv.invoiceNo }}</span>
            <span class="status-tag" :class="inv.status">{{ statusText(INVOICE_STATUS_TEXT, inv.status) }}</span>
          </template>
        </VanCell>
      </VanCellGroup>
      <div v-else class="card">
        <VanEmpty description="暂无账单" />
      </div>

      <div class="card actions">
        <VanButton block plain @click="router.push('/history')">历史缴费查询</VanButton>
        <VanButton block plain type="danger" style="margin-top: 8px" @click="handleLogout">
          退出登录
        </VanButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.summary {
  text-align: left;
}
.period-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.status-tag {
  margin-left: 8px;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #f2f3f5;
  color: #969799;
}
.status-tag.paid {
  background: #e8f8f0;
  color: #07c160;
}
.status-tag.pending,
.status-tag.processing {
  background: #fff7e8;
  color: #ff976a;
}
.status-tag.refunded,
.status-tag.refunding {
  background: #f2f3f5;
  color: #646566;
}
.status-tag.voided {
  background: #f7f8fa;
  color: #c8c9cc;
}
.actions {
  margin-bottom: 24px;
}
</style>
