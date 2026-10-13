<template>
  <div class="page-card">
    <div class="toolbar">
      <el-select v-model="filters.campusId" placeholder="全部校区" clearable style="width: 170px" @change="load">
        <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select v-model="filters.feePeriodId" placeholder="全部收费期" clearable style="width: 190px" @change="load">
        <el-option v-for="p in feePeriods" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
      <el-date-picker v-model="dateRange" type="daterange" range-separator="至" start-placeholder="开始日期"
        end-placeholder="结束日期" style="width: 240px" @change="load" />
      <el-button type="primary" @click="load">查询</el-button>
      <div class="spacer" />
      <el-button @click="exportVisible = true">受控导出</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />

    <!-- 汇总卡片 -->
    <el-row :gutter="16" class="mb" v-loading="loading">
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">应收(元)</div>
          <div class="stat-value">{{ fenToYuanGrouped(stats?.receivableFen) }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">实收(元)</div>
          <div class="stat-value success">{{ fenToYuanGrouped(stats?.receivedFen) }}</div>
          <div class="stat-sub">成功订单 {{ stats?.paidOrderCount ?? 0 }} / {{ stats?.orderCount ?? 0 }} 笔</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">待收(元)</div>
          <div class="stat-value warning">{{ fenToYuanGrouped(stats?.pendingFen) }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">退款(元)</div>
          <div class="stat-value danger">{{ fenToYuanGrouped(stats?.refundedFen) }}</div>
          <div class="stat-sub">成功退款 {{ stats?.refundCount ?? 0 }} 笔</div>
        </el-card>
      </el-col>
    </el-row>

    <el-alert type="info" :closable="false" class="mb">
      口径说明:实收以确认成功的支付交易为准(不含仅创建未支付的订单);退款按成功退款记录统计。
    </el-alert>

    <!-- 趋势图 -->
    <el-card shadow="never" class="mb">
      <template #header><span>收支概览</span></template>
      <div ref="chartRef" class="chart" />
    </el-card>

    <!-- 受控导出 -->
    <el-dialog v-model="exportVisible" title="受控导出" width="520px">
      <el-form :model="exportForm" label-width="100px">
        <el-form-item label="导出类型">
          <el-select v-model="exportForm.type" style="width: 100%">
            <el-option label="订单明细(CSV)" value="orders_csv" />
            <el-option label="账单明细(XLSX)" value="invoices_xlsx" />
            <el-option label="对账单(CSV)" value="reconcile_csv" />
          </el-select>
        </el-form-item>
        <el-alert type="warning" :closable="false">
          导出将按当前筛选条件执行,记录导出人、时间与筛选条件;手机号等敏感字段默认脱敏。
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="exportVisible = false">取消</el-button>
        <el-button type="primary" :loading="exportLoading" @click="doExport">创建导出任务</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import * as echarts from 'echarts'
import { adminApi, toArray } from '../api/admin'
import type { Campus, CollectionStats, FeePeriod } from '../api/types'
import { fenToYuanGrouped } from '../utils/format'
import type { NormalizedError } from '../api/client'

const campuses = ref<Campus[]>([])
const feePeriods = ref<FeePeriod[]>([])
const filters = ref({ campusId: '', feePeriodId: '' })
const dateRange = ref<[Date, Date] | null>(null)
const stats = ref<CollectionStats | null>(null)
const loading = ref(false)
const error = ref('')
const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const exportVisible = ref(false)
const exportLoading = ref(false)
const exportForm = ref({ type: 'orders_csv' })

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params: Record<string, unknown> = {
      campusId: filters.value.campusId || undefined,
      feePeriodId: filters.value.feePeriodId || undefined,
    }
    if (dateRange.value) {
      params.dateFrom = dateRange.value[0].toISOString().slice(0, 10)
      params.dateTo = dateRange.value[1].toISOString().slice(0, 10)
    }
    stats.value = await adminApi.collections(params as Parameters<typeof adminApi.collections>[0])
    renderChart()
  } catch (e) {
    error.value = (e as NormalizedError).message
  } finally {
    loading.value = false
  }
}

function renderChart() {
  if (!chartRef.value) return
  if (!chart) chart = echarts.init(chartRef.value)
  const s = stats.value
  chart.setOption({
    tooltip: { trigger: 'item', valueFormatter: (v: number) => `${(v / 100).toFixed(2)} 元` },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['45%', '70%'],
        label: { formatter: '{b}\n{d}%' },
        data: [
          { name: '实收', value: s?.receivedFen ?? 0, itemStyle: { color: '#67c23a' } },
          { name: '待收', value: s?.pendingFen ?? 0, itemStyle: { color: '#e6a23c' } },
          { name: '退款', value: s?.refundedFen ?? 0, itemStyle: { color: '#f56c6c' } },
        ],
      },
    ],
  })
}

async function doExport() {
  exportLoading.value = true
  try {
    const filtersPayload: Record<string, unknown> = {
      campusId: filters.value.campusId || undefined,
      feePeriodId: filters.value.feePeriodId || undefined,
    }
    if (dateRange.value) {
      filtersPayload.dateFrom = dateRange.value[0].toISOString().slice(0, 10)
      filtersPayload.dateTo = dateRange.value[1].toISOString().slice(0, 10)
    }
    const { taskId } = await adminApi.createExport({ type: exportForm.value.type, filters: filtersPayload })
    ElMessage.success(`导出任务已创建:${taskId},完成后请在审计日志中查看下载记录`)
    exportVisible.value = false
  } catch (e) {
    ElMessage.error((e as NormalizedError).message)
  } finally {
    exportLoading.value = false
  }
}

onMounted(async () => {
  try {
    campuses.value = toArray(await adminApi.campuses({ pageSize: 100 }))
    feePeriods.value = toArray(await adminApi.feePeriods({ pageSize: 100 }))
  } catch {
    /* 忽略 */
  }
  await nextTick()
  load()
  window.addEventListener('resize', () => chart?.resize())
})
</script>

<style scoped>
.stat-card {
  text-align: center;
}

.stat-label {
  color: #909399;
  font-size: 13px;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 26px;
  font-weight: 700;
  color: #303133;
}

.stat-value.success {
  color: #67c23a;
}

.stat-value.warning {
  color: #e6a23c;
}

.stat-value.danger {
  color: #f56c6c;
}

.stat-sub {
  color: #909399;
  font-size: 12px;
  margin-top: 6px;
}

.chart {
  height: 320px;
}
</style>
