<template>
  <div class="page-card">
    <div class="toolbar">
      <el-input v-model="filters.keyword" placeholder="商户订单号/微信交易号/账单号" clearable style="width: 240px" @change="load" />
      <el-select v-model="filters.campusId" placeholder="全部校区" clearable style="width: 160px" @change="load">
        <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select v-model="filters.feePeriodId" placeholder="全部收费期" clearable style="width: 180px" @change="load">
        <el-option v-for="p in feePeriods" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
      <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 130px" @change="load">
        <el-option label="已创建" value="created" />
        <el-option label="待支付" value="pending" />
        <el-option label="已支付" value="paid" />
        <el-option label="失败" value="failed" />
        <el-option label="已关闭" value="closed" />
      </el-select>
      <el-date-picker v-model="dateRange" type="daterange" range-separator="至" start-placeholder="开始日期"
        end-placeholder="结束日期" style="width: 240px" @change="load" />
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />
    <el-alert type="info" :closable="false" class="mb">
      支付成功状态只能通过服务端验证(通知验签 / 查单)更新；前端回调不作为入账依据。
    </el-alert>

    <el-table v-loading="loading" :data="items" border>
      <el-table-column prop="outTradeNo" label="商户订单号" width="200" />
      <el-table-column label="账单号" width="160">
        <template #default="{ row }">{{ row.invoiceNo ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="金额(元)" width="110" align="right">
        <template #default="{ row }"><span class="amount">{{ fenToYuan(row.amountFen) }}</span></template>
      </el-table-column>
      <el-table-column label="渠道" width="80">
        <template #default="{ row }">{{ row.channel === 'WECHAT' ? '微信' : row.channel }}</template>
      </el-table-column>
      <el-table-column label="微信交易号" width="200">
        <template #default="{ row }">{{ row.wechatTransactionId ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="orderTagType(row.status)">{{ statusText(ORDER_STATUS_TEXT, row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="165">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="支付完成" width="165">
        <template #default="{ row }">{{ formatDateTime(row.paidAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" @click="openDetail(row)">详情</el-button>
          <el-button v-if="['created', 'pending'].includes(row.status)" text type="warning" :loading="reconcilingId === row.id"
            @click="onReconcile(row)">服务端查单</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="!loading && !error" description="暂无支付订单" />
      </template>
    </el-table>

    <div class="pagination-bar">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total"
        :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
    </div>

    <!-- 订单详情 -->
    <el-drawer v-model="detailVisible" title="支付订单详情" size="620px">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="商户订单号">{{ detail?.outTradeNo }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ statusText(ORDER_STATUS_TEXT, detail?.status) }}</el-descriptions-item>
        <el-descriptions-item label="账单号">{{ detail?.invoiceNo ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="金额(元)"><span class="amount">{{ fenToYuan(detail?.amountFen) }}</span></el-descriptions-item>
        <el-descriptions-item label="微信交易号">{{ detail?.wechatTransactionId ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="支付完成时间">{{ formatDateTime(detail?.paidAt) }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatDateTime(detail?.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="更新时间">{{ formatDateTime(detail?.updatedAt) }}</el-descriptions-item>
      </el-descriptions>
      <el-alert type="info" :closable="false" class="mt">
        支付请求摘要、通知处理结果与查单记录由后端记录,本页仅展示订单核心状态;敏感密钥不会出现在任何响应中。
      </el-alert>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi, toArray } from '../api/admin'
import type { Campus, FeePeriod, PaymentOrder } from '../api/types'
import { ORDER_STATUS_TEXT, fenToYuan, formatDateTime, statusText } from '../utils/format'
import type { NormalizedError } from '../api/client'

const items = ref<PaymentOrder[]>([])
const campuses = ref<Campus[]>([])
const feePeriods = ref<FeePeriod[]>([])
const loading = ref(false)
const error = ref('')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const filters = ref({ keyword: '', campusId: '', feePeriodId: '', status: '' })
const dateRange = ref<[Date, Date] | null>(null)
const detailVisible = ref(false)
const detail = ref<PaymentOrder | null>(null)
const reconcilingId = ref<string | null>(null)

function orderTagType(s: PaymentOrder['status']): string {
  return s === 'paid' ? 'success' : s === 'failed' || s === 'closed' ? 'info' : 'warning'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params: Record<string, unknown> = {
      page: page.value,
      pageSize: pageSize.value,
      keyword: filters.value.keyword || undefined,
      campusId: filters.value.campusId || undefined,
      feePeriodId: filters.value.feePeriodId || undefined,
      status: filters.value.status || undefined,
    }
    if (dateRange.value) {
      params.dateFrom = dateRange.value[0].toISOString().slice(0, 10)
      params.dateTo = dateRange.value[1].toISOString().slice(0, 10)
    }
    const res = await adminApi.paymentOrders(params as Parameters<typeof adminApi.paymentOrders>[0])
    const arr = toArray(res)
    items.value = arr
    total.value = Array.isArray(res) ? arr.length : (res as { total: number }).total
  } catch (e) {
    error.value = (e as NormalizedError).message
  } finally {
    loading.value = false
  }
}

async function loadBase() {
  try {
    campuses.value = toArray(await adminApi.campuses({ pageSize: 100 }))
    feePeriods.value = toArray(await adminApi.feePeriods({ pageSize: 100 }))
  } catch {
    /* 基础数据加载失败不阻断主列表 */
  }
}

function openDetail(row: PaymentOrder) {
  detail.value = row
  detailVisible.value = true
}

/** 服务端查单:处理通知丢失/延迟导致的"支付处理中" */
async function onReconcile(row: PaymentOrder) {
  reconcilingId.value = row.id
  try {
    const updated = await adminApi.reconcileOrder(row.id)
    const idx = items.value.findIndex((o) => o.id === row.id)
    if (idx >= 0) items.value[idx] = updated
    ElMessage.success(`查单完成,当前状态:${statusText(ORDER_STATUS_TEXT, updated.status)}`)
  } catch (e) {
    ElMessage.error((e as NormalizedError).message)
  } finally {
    reconcilingId.value = null
  }
}

onMounted(() => {
  loadBase()
  load()
})
</script>

<style scoped>
.mt {
  margin-top: 16px;
}
</style>
