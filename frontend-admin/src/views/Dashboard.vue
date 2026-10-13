<template>
  <div class="page-card">
    <div class="toolbar">
      <el-select v-model="filters.campusId" placeholder="全部校区" clearable style="width: 180px" @change="load">
        <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select v-model="filters.feePeriodId" placeholder="全部收费期" clearable style="width: 200px" @change="load">
        <el-option v-for="p in feePeriods" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
      <el-date-picker v-model="dateRange" type="daterange" range-separator="至" start-placeholder="开始日期"
        end-placeholder="结束日期" value-format="YYYY-MM-DD" @change="load" />
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon class="mb" @close="error = ''" />

    <el-row :gutter="16" v-loading="loading">
      <el-col :span="6" v-for="card in cards" :key="card.key">
        <el-card shadow="never" class="stat-card">
          <div class="stat-label">{{ card.label }}</div>
          <div class="stat-value amount">{{ card.value }}</div>
          <div class="stat-unit">元</div>
        </el-card>
      </el-col>
    </el-row>

    <div class="chart-wrap">
      <div class="chart-title">金额统计</div>
      <div ref="chartEl" class="chart" />
      <el-empty v-if="!loading && !error && !hasData" description="暂无统计数据" />
    </div>

    <el-row :gutter="16" class="order-row" v-loading="loading">
      <el-col :span="8">
        <el-card shadow="never"><el-statistic title="支付订单数" :value="stats?.orderCount ?? 0" /></el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never"><el-statistic title="成功支付订单数" :value="stats?.paidOrderCount ?? 0" /></el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never"><el-statistic title="退款笔数" :value="stats?.refundCount ?? 0" /></el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import * as echarts from 'echarts'
import type { ECharts } from 'echarts'
import { adminApi, toArray } from '../api/admin'
import { fenToYuanGrouped } from '../utils/format'
import type { Campus, CollectionStats, FeePeriod } from '../api/types'
import type { NormalizedError as NE } from '../api/client'

const filters = reactive({ campusId: '', feePeriodId: '' })
const dateRange = ref<[string, string] | null>(null)
const campuses = ref<Campus[]>([])
const feePeriods = ref<FeePeriod[]>([])
const stats = ref<CollectionStats | null>(null)
const loading = ref(false)
const error = ref('')
const chartEl = ref<HTMLDivElement | null>(null)
let chart: ECharts | null = null

const cards = computed(() => [
  { key: 'receivable', label: '应收金额', value: fenToYuanGrouped(stats.value?.receivableFen) },
  { key: 'received', label: '实收金额', value: fenToYuanGrouped(stats.value?.receivedFen) },
  { key: 'pending', label: '待收金额', value: fenToYuanGrouped(stats.value?.pendingFen) },
  { key: 'refunded', label: '退款金额', value: fenToYuanGrouped(stats.value?.refundedFen) },
])

const hasData = computed(() => {
  const s = stats.value
  return !!s && (s.receivableFen > 0 || s.receivedFen > 0 || s.pendingFen > 0 || s.refundedFen > 0)
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    stats.value = await adminApi.collections({
      campusId: filters.campusId || undefined,
      feePeriodId: filters.feePeriodId || undefined,
      dateFrom: dateRange.value?.[0],
      dateTo: dateRange.value?.[1],
    })
    renderChart()
  } catch (e) {
    error.value = (e as NE).message || '加载统计失败'
  } finally {
    loading.value = false
  }
}

function renderChart() {
  if (!chartEl.value) return
  if (!chart) chart = echarts.init(chartEl.value)
  const s = stats.value
  chart.setOption({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: ['应收', '实收', '待收', '退款'] },
    yAxis: { type: 'value', name: '元' },
    series: [
      {
        type: 'bar',
        data: s
          ? [s.receivableFen / 100, s.receivedFen / 100, s.pendingFen / 100, s.refundedFen / 100]
          : [0, 0, 0, 0],
        itemStyle: { color: '#409eff' },
        label: { show: true, formatter: '{c}' },
      },
    ],
  })
}

onMounted(async () => {
  window.addEventListener('resize', onResize)
  try {
    const [c, p] = await Promise.all([adminApi.campuses({ pageSize: 100 }), adminApi.feePeriods({ pageSize: 100 })])
    campuses.value = toArray(c)
    feePeriods.value = toArray(p)
  } catch (e) {
    ElMessage.error((e as NE).message || '加载筛选条件失败')
  }
  await load()
})

function onResize() {
  chart?.resize()
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
}

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
  font-weight: 600;
}

.stat-unit {
  color: #c0c4cc;
  font-size: 12px;
  margin-top: 4px;
}

.chart-wrap {
  margin-top: 24px;
}

.chart-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 8px;
}

.chart {
  height: 320px;
}

.order-row {
  margin-top: 24px;
}
</style>
