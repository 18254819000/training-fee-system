<script setup lang="ts">
/** 页面 E:支付结果 —— PRD §6.2
 * 不以 JSAPI 前端回调为准,轮询服务端订单状态(PRD §3.3):
 * paid → 成功;failed/closed → 失败·待确认;pending/created → 处理中(继续轮询)
 */
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Button as VanButton,
  Empty as VanEmpty,
  Loading as VanLoading,
  NavBar as VanNavBar,
} from 'vant';
import { studentApi } from '../api/student';
import { fenToYuan, formatDateTime } from '../utils/format';
import type { PaymentOrder } from '../api/types';

type ViewState = 'polling' | 'success' | 'failed' | 'error';

const route = useRoute();
const router = useRouter();

const viewState = ref<ViewState>('polling');
const order = ref<PaymentOrder | null>(null);
const pollCount = ref(0);

const MAX_POLLS = 40; // 约 2 分钟
const POLL_INTERVAL = 3000;
let timer: number | null = null;

function stopPolling() {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

async function pollOnce(): Promise<boolean> {
  try {
    const o = await studentApi.paymentStatus(route.params.orderId as string);
    order.value = o;
    if (o.status === 'paid') {
      viewState.value = 'success';
      stopPolling();
      return true;
    }
    if (o.status === 'failed' || o.status === 'closed') {
      viewState.value = 'failed';
      stopPolling();
      return true;
    }
    return false;
  } catch {
    // 单次查询失败不直接判死,继续轮询;超过上限再报异常
    return false;
  }
}

async function tick() {
  pollCount.value += 1;
  const done = await pollOnce();
  if (!done && pollCount.value >= MAX_POLLS) {
    stopPolling();
    viewState.value = 'failed';
  }
}

function startPolling() {
  stopPolling();
  viewState.value = 'polling';
  pollCount.value = 0;
  void tick();
  timer = window.setInterval(() => {
    void tick();
  }, POLL_INTERVAL);
}

onMounted(startPolling);
onUnmounted(stopPolling);
</script>

<template>
  <div class="page">
    <VanNavBar title="支付结果" :left-arrow="viewState !== 'polling'" @click-left="router.replace('/')" />

    <div v-if="viewState === 'polling'" class="card result">
      <VanLoading size="36" />
      <h2>支付处理中</h2>
      <p class="muted">正在向学校系统确认支付结果,请勿关闭页面…</p>
    </div>

    <div v-else-if="viewState === 'success'" class="card result">
      <div class="icon ok">✓</div>
      <h2>支付成功</h2>
      <p class="muted">缴费已完成,感谢您的配合</p>
      <div class="kv-list">
        <div class="row-between kv"><span class="muted">实付金额</span><span class="amount">¥{{ fenToYuan(order?.amountFen) }}</span></div>
        <div class="row-between kv"><span class="muted">商户订单号</span><span class="mono">{{ order?.outTradeNo }}</span></div>
        <div class="row-between kv"><span class="muted">支付时间</span><span>{{ formatDateTime(order?.paidAt) }}</span></div>
      </div>
      <VanButton type="primary" block @click="router.replace('/')">返回首页</VanButton>
    </div>

    <div v-else-if="viewState === 'failed'" class="card result">
      <div class="icon warn">!</div>
      <h2>支付未确认</h2>
      <p class="muted">
        未能确认本次支付成功。如您已完成扣款,请稍后在"历史缴费查询"中查看,
        或联系学校老师核实,切勿重复支付。
      </p>
      <VanButton plain type="primary" block @click="startPolling">重新查询状态</VanButton>
      <VanButton plain block style="margin-top: 8px" @click="router.replace('/')">返回首页</VanButton>
    </div>

    <div v-else class="empty-wrap">
      <VanEmpty description="订单信息异常">
        <VanButton plain type="primary" size="small" @click="router.replace('/')">返回首页</VanButton>
      </VanEmpty>
    </div>
  </div>
</template>

<style scoped>
.result {
  text-align: center;
  padding: 36px 20px;
}
.result h2 {
  margin: 16px 0 8px;
  font-size: 20px;
}
.icon {
  width: 64px;
  height: 64px;
  margin: 0 auto;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  color: #fff;
}
.icon.ok {
  background: #07c160;
}
.icon.warn {
  background: #ff976a;
}
.kv-list {
  text-align: left;
  margin: 20px 0;
}
.kv {
  margin-top: 8px;
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  word-break: break-all;
}
</style>
