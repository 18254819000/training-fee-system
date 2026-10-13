<template>
  <div class="page-card">
    <div class="toolbar">
      <el-input v-model="filters.keyword" placeholder="按名称/编码搜索" clearable style="width: 220px" @change="load" />
      <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 140px" @change="load">
        <el-option label="启用" value="active" />
        <el-option label="停用" value="inactive" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <div class="spacer" />
      <el-button type="primary" @click="openCreate">新增收费项目</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />

    <el-table v-loading="loading" :data="items" border>
      <el-table-column prop="code" label="项目编码" width="140" />
      <el-table-column prop="name" label="项目名称" />
      <el-table-column prop="description" label="描述" show-overflow-tooltip />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'">{{ row.status === 'active' ? '启用' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="更新时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button text type="primary" @click="openPriceHistory(row)">调价历史</el-button>
          <el-button text type="success" @click="openSetPrice(row)">设置价格</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="!loading && !error" description="暂无收费项目" />
      </template>
    </el-table>

    <div class="pagination-bar">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total"
        :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
    </div>

    <!-- 项目新增/编辑 -->
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑收费项目' : '新增收费项目'" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="form.name" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="项目编码" prop="code">
          <el-input v-model="form.code" maxlength="32" placeholder="唯一编码" :disabled="!!editing" />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="3" maxlength="500" />
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="inactive" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 按校区设置价格 -->
    <el-dialog v-model="priceVisible" title="设置校区价格" width="560px">
      <el-form ref="priceFormRef" :model="priceForm" :rules="priceRules" label-width="110px">
        <el-form-item label="收费项目">
          <span>{{ priceItem?.name }}</span>
        </el-form-item>
        <el-form-item label="校区" prop="campusId">
          <el-select v-model="priceForm.campusId" placeholder="请选择校区" style="width: 100%">
            <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="价格(元)" prop="amountYuan">
          <el-input-number v-model="priceForm.amountYuan" :min="0.01" :precision="2" :step="100" style="width: 100%" />
        </el-form-item>
        <el-form-item label="生效日期" prop="effectiveFrom">
          <el-date-picker v-model="priceForm.effectiveFrom" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="失效日期">
          <el-date-picker v-model="priceForm.effectiveTo" type="date" value-format="YYYY-MM-DD" placeholder="可选"
            style="width: 100%" />
        </el-form-item>
      </el-form>
      <el-alert type="info" :closable="false" class="mb">
        调价不影响已生成账单的价格快照;同一项目、校区、有效期内不得存在冲突的价格规则(由服务端校验)。
      </el-alert>
      <template #footer>
        <el-button @click="priceVisible = false">取消</el-button>
        <el-button type="primary" :loading="priceSubmitting" @click="onPriceSubmit">保存价格</el-button>
      </template>
    </el-dialog>

    <!-- 调价历史 -->
    <el-drawer v-model="historyVisible" :title="`调价历史 — ${priceItem?.name ?? ''}`" size="640px">
      <el-alert v-if="historyError" type="error" :title="historyError" show-icon @close="historyError = ''" class="mb" />
      <el-table v-loading="historyLoading" :data="priceHistory" border>
        <el-table-column label="校区" width="130">
          <template #default="{ row }">{{ row.campusName ?? campusName(row.campusId) }}</template>
        </el-table-column>
        <el-table-column label="价格(元)" width="120" align="right">
          <template #default="{ row }"><span class="amount">{{ fenToYuan(row.amountFen) }}</span></template>
        </el-table-column>
        <el-table-column label="生效日期" width="120">
          <template #default="{ row }">{{ formatDate(row.effectiveFrom) }}</template>
        </el-table-column>
        <el-table-column label="失效日期" width="120">
          <template #default="{ row }">{{ row.effectiveTo ? formatDate(row.effectiveTo) : '长期有效' }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="!historyLoading && !historyError" description="暂无价格记录" />
        </template>
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { adminApi, toArray, toPage } from '../api/admin'
import { fenToYuan, formatDate, formatDateTime } from '../utils/format'
import type { Campus, CampusFeePrice, FeeItem } from '../api/types'
import type { NormalizedError } from '../api/client'

const items = ref<FeeItem[]>([])
const campuses = ref<Campus[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const error = ref('')
const filters = reactive({ keyword: '', status: '' })

function campusName(id: string): string {
  return campuses.value.find((c) => c.id === id)?.name ?? '-'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [res, c] = await Promise.all([
      adminApi.feeItems({
        page: page.value,
        pageSize: pageSize.value,
        keyword: filters.keyword || undefined,
        status: filters.status || undefined,
      }),
      adminApi.campuses({ pageSize: 200 }),
    ])
    items.value = toArray(res)
    total.value = toPage(res, page.value, pageSize.value).total
    campuses.value = toArray(c)
  } catch (e) {
    error.value = (e as NormalizedError).message || '加载收费项目失败'
  } finally {
    loading.value = false
  }
}

// ---------- 项目 CRUD ----------
const dialogVisible = ref(false)
const editing = ref<FeeItem | null>(null)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({ name: '', code: '', description: '', status: 'active' as 'active' | 'inactive' })
const rules: FormRules = {
  name: [
    { required: true, message: '请输入项目名称', trigger: 'blur' },
    { min: 2, max: 100, message: '名称长度 2–100 个字符', trigger: 'blur' },
  ],
  code: [{ required: true, message: '请输入项目编码', trigger: 'blur' }],
}

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', code: '', description: '', status: 'active' })
  dialogVisible.value = true
}

function openEdit(row: FeeItem) {
  editing.value = row
  Object.assign(form, { name: row.name, code: row.code, description: row.description ?? '', status: row.status })
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
      description: form.description.trim() || undefined,
      status: form.status,
    }
    if (editing.value) {
      await adminApi.updateFeeItem(editing.value.id, payload)
      ElMessage.success('收费项目已更新')
    } else {
      await adminApi.createFeeItem(payload)
      ElMessage.success('收费项目已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '保存失败')
  } finally {
    submitting.value = false
  }
}

// ---------- 校区价格 ----------
const priceVisible = ref(false)
const priceItem = ref<FeeItem | null>(null)
const priceFormRef = ref<FormInstance>()
const priceSubmitting = ref(false)
const priceForm = reactive({
  campusId: '',
  amountYuan: 0 as number | undefined,
  effectiveFrom: '',
  effectiveTo: '',
})
const priceRules: FormRules = {
  campusId: [{ required: true, message: '请选择校区', trigger: 'change' }],
  amountYuan: [
    {
      required: true,
      validator: (_r, v: number, cb) => {
        if (v === undefined || v === null) return cb(new Error('请输入价格'))
        if (v <= 0) return cb(new Error('收费项目价格必须大于 0'))
        cb()
      },
      trigger: 'blur',
    },
  ],
  effectiveFrom: [{ required: true, message: '请选择生效日期', trigger: 'change' }],
}

function openSetPrice(row: FeeItem) {
  priceItem.value = row
  Object.assign(priceForm, { campusId: '', amountYuan: undefined, effectiveFrom: '', effectiveTo: '' })
  priceVisible.value = true
}

async function onPriceSubmit() {
  const valid = await priceFormRef.value?.validate().catch(() => false)
  if (!valid || !priceItem.value) return
  priceSubmitting.value = true
  try {
    await adminApi.createCampusPrice({
      feeItemId: priceItem.value.id,
      campusId: priceForm.campusId,
      amountFen: Math.round((priceForm.amountYuan ?? 0) * 100),
      effectiveFrom: priceForm.effectiveFrom,
      effectiveTo: priceForm.effectiveTo || undefined,
    })
    ElMessage.success('价格已保存')
    priceVisible.value = false
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '保存价格失败')
  } finally {
    priceSubmitting.value = false
  }
}

// ---------- 调价历史 ----------
const historyVisible = ref(false)
const historyLoading = ref(false)
const historyError = ref('')
const priceHistory = ref<CampusFeePrice[]>([])

async function openPriceHistory(row: FeeItem) {
  priceItem.value = row
  historyVisible.value = true
  historyLoading.value = true
  historyError.value = ''
  try {
    priceHistory.value = await adminApi.campusPrices({ feeItemId: row.id })
  } catch (e) {
    historyError.value = (e as NormalizedError).message || '加载调价历史失败'
  } finally {
    historyLoading.value = false
  }
}

load()
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
}
</style>
