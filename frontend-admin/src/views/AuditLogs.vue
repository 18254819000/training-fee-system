<template>
  <div class="page-card">
    <el-alert type="info" :closable="false" class="mb">
      审计日志只读,普通管理员不能修改或删除;不记录密码、完整登录码、私钥或 APIv3 密钥。
    </el-alert>
    <div class="toolbar">
      <el-input v-model="filters.keyword" placeholder="按操作者/资源/请求ID搜索" clearable style="width: 260px" @change="onFilter" />
      <el-input v-model="filters.action" placeholder="按操作类型筛选,如 invoice.generate" clearable style="width: 240px"
        @change="onFilter" />
      <el-date-picker v-model="dateRange" type="daterange" range-separator="至" start-placeholder="开始日期"
        end-placeholder="结束日期" value-format="YYYY-MM-DD" @change="onFilter" />
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />

    <el-table v-loading="loading" :data="items" border>
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作者" width="180">
        <template #default="{ row }">
          <div>{{ row.actorType }}</div>
          <div class="sub">{{ maskId(row.actorId) }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="action" label="操作" min-width="180" show-overflow-tooltip />
      <el-table-column label="资源" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.resourceType">{{ row.resourceType }}<span class="sub"> / {{ maskId(row.resourceId) }}</span></span>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="结果" width="90">
        <template #default="{ row }">
          <el-tag :type="resultTag(row.result)">{{ resultText(row.result) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="requestId" label="请求追踪 ID" width="200" show-overflow-tooltip>
        <template #default="{ row }"><span class="sub">{{ row.requestId ?? '-' }}</span></template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="!loading && !error" description="暂无审计记录" />
      </template>
    </el-table>

    <div class="pagination-bar">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total"
        :page-sizes="[10, 20, 50, 100]" layout="total, sizes, prev, pager, next" @change="load" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { adminApi, toArray, toPage } from '../api/admin'
import { formatDateTime } from '../utils/format'
import type { AuditLog, PageResult } from '../api/types'
import type { NormalizedError } from '../api/client'

const items = ref<AuditLog[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const error = ref('')
const filters = reactive({ keyword: '', action: '' })
const dateRange = ref<[string, string] | null>(null)

// 审计日志中的内部 ID 做脱敏展示,避免暴露可利用的标识
function maskId(id: string | undefined): string {
  if (!id) return '-'
  return id.length <= 8 ? '****' : `${id.slice(0, 4)}****${id.slice(-4)}`
}

function resultText(r: string): string {
  return r === 'success' ? '成功' : r === 'failed' ? '失败' : r === 'denied' ? '拒绝' : r
}
function resultTag(r: string): string {
  return r === 'success' ? 'success' : r === 'failed' ? 'danger' : r === 'denied' ? 'warning' : 'info'
}

function onFilter() {
  page.value = 1
  load()
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res: PageResult<AuditLog> | AuditLog[] = await adminApi.auditLogs({
      page: page.value,
      pageSize: pageSize.value,
      keyword: filters.keyword || undefined,
      action: filters.action || undefined,
      dateFrom: dateRange.value?.[0],
      dateTo: dateRange.value?.[1],
    })
    items.value = toArray(res)
    total.value = toPage(res, page.value, pageSize.value).total
  } catch (e) {
    error.value = (e as NormalizedError).message || '加载审计日志失败'
  } finally {
    loading.value = false
  }
}

load()
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
}
.sub {
  font-size: 12px;
  color: #909399;
}
</style>
