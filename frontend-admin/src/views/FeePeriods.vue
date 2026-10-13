<template>
  <div class="page-card">
    <div class="toolbar">
      <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 140px" @change="load">
        <el-option label="草稿" value="draft" />
        <el-option label="开放中" value="open" />
        <el-option label="已结束" value="closed" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <div class="spacer" />
      <el-button type="primary" @click="openCreate">新建收费期</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />

    <el-table v-loading="loading" :data="items" border>
      <el-table-column prop="code" label="编码" width="130" />
      <el-table-column prop="name" label="名称" />
      <el-table-column label="起止日期" width="230">
        <template #default="{ row }">{{ formatDate(row.startDate) }} 至 {{ formatDate(row.endDate) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'open' ? 'success' : row.status === 'draft' ? 'info' : 'warning'">
            {{ statusText(PERIOD_STATUS_TEXT, row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="适用校区" width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ campusNames(row) }}</template>
      </el-table-column>
      <el-table-column label="更新时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="280" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'draft'" text type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status === 'draft'" text type="success" @click="transition(row, 'open')">开放</el-button>
          <el-button v-if="row.status === 'open'" text type="warning" @click="transition(row, 'closed')">结束</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="!loading && !error" description="暂无收费期数据" />
      </template>
    </el-table>

    <div class="pagination-bar">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total"
        :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑收费期' : '新建收费期'" width="600px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="编码" prop="code">
          <el-input v-model="form.code" maxlength="32" placeholder="唯一编码,如 2026S1" :disabled="!!editing" />
        </el-form-item>
        <el-form-item label="起止日期" prop="dateRange">
          <el-date-picker v-model="form.dateRange" type="daterange" range-separator="至" start-placeholder="开始日期"
            end-placeholder="结束日期" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="适用校区" prop="campusIds">
          <el-select v-model="form.campusIds" multiple placeholder="请选择适用校区(空=全校区)" style="width: 100%">
            <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { adminApi, toArray, toPage } from '../api/admin'
import { PERIOD_STATUS_TEXT, formatDate, formatDateTime, statusText } from '../utils/format'
import type { Campus, FeePeriod, FeePeriodStatus } from '../api/types'
import type { NormalizedError } from '../api/client'

const items = ref<FeePeriod[]>([])
const campuses = ref<Campus[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const error = ref('')
const filters = reactive({ status: '' })

const dialogVisible = ref(false)
const editing = ref<FeePeriod | null>(null)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({
  name: '',
  code: '',
  dateRange: [] as string[],
  campusIds: [] as string[],
})

const rules: FormRules = {
  name: [
    { required: true, message: '请输入收费期名称', trigger: 'blur' },
    { min: 2, max: 100, message: '名称长度 2–100 个字符', trigger: 'blur' },
  ],
  code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  dateRange: [
    {
      required: true,
      validator: (_r, v: string[], cb) => {
        if (!v || v.length !== 2) return cb(new Error('请选择起止日期'))
        if (v[1] < v[0]) return cb(new Error('结束日期不得早于开始日期'))
        cb()
      },
      trigger: 'change',
    },
  ],
}

function campusNames(row: FeePeriod): string {
  if (!row.campusIds || row.campusIds.length === 0) return '全部校区'
  return row.campusIds
    .map((id) => campuses.value.find((c) => c.id === id)?.name ?? id)
    .join('、')
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [res, c] = await Promise.all([
      adminApi.feePeriods({ page: page.value, pageSize: pageSize.value, status: filters.status || undefined }),
      adminApi.campuses({ pageSize: 200 }),
    ])
    items.value = toArray(res)
    total.value = toPage(res, page.value, pageSize.value).total
    campuses.value = toArray(c)
  } catch (e) {
    error.value = (e as NormalizedError).message || '加载收费期失败'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', code: '', dateRange: [], campusIds: [] as string[] })
  dialogVisible.value = true
}

function openEdit(row: FeePeriod) {
  editing.value = row
  Object.assign(form, {
    name: row.name,
    code: row.code,
    dateRange: [row.startDate?.slice(0, 10), row.endDate?.slice(0, 10)],
    campusIds: row.campusIds ?? [],
  })
  dialogVisible.value = true
}

async function onSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      startDate: form.dateRange[0],
      endDate: form.dateRange[1],
      campusIds: form.campusIds,
    }
    if (editing.value) {
      await adminApi.updateFeePeriod(editing.value.id, payload)
      ElMessage.success('收费期已更新')
    } else {
      await adminApi.createFeePeriod(payload)
      ElMessage.success('收费期已创建(草稿)')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '保存失败')
  } finally {
    submitting.value = false
  }
}

// 状态流转:草稿 -> 开放 -> 已结束(符合 PRD §4.3,不可逆)
async function transition(row: FeePeriod, target: FeePeriodStatus) {
  const tips: Record<string, string> = {
    open: `确定开放收费期「${row.name}」吗?开放后允许生成新账单。`,
    closed: `确定结束收费期「${row.name}」吗?结束后禁止新增账单,历史账单仍可查询和退款。`,
  }
  try {
    await ElMessageBox.confirm(tips[target], '确认状态流转', { type: 'warning' })
  } catch {
    return
  }
  try {
    await adminApi.updateFeePeriod(row.id, { status: target })
    ElMessage.success('状态已更新')
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '状态流转失败')
  }
}

load()
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
}
</style>
