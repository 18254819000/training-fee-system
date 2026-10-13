<template>
  <div class="page-card">
    <div class="toolbar">
      <el-input v-model="filters.keyword" placeholder="按名称搜索" clearable style="width: 220px" @change="load" />
      <el-select v-model="filters.campusId" placeholder="全部校区" clearable style="width: 170px" @change="load">
        <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
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
      <el-table-column prop="name" label="项目名称" min-width="140" />
      <el-table-column label="所属校区" width="140">
        <template #default="{ row }">{{ row.campus?.name ?? campusName(row.campusId) }}</template>
      </el-table-column>
      <el-table-column label="价格(元)" width="110" align="right">
        <template #default="{ row }"><span class="amount">{{ fenToYuan(row.amountFen) }}</span></template>
      </el-table-column>
      <el-table-column label="绑定收费期" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.feePeriods?.length">{{ row.feePeriods.map((p: any) => p.name).join('、') }}</span>
          <span v-else class="text-muted">未绑定</span>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="描述" show-overflow-tooltip min-width="120" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'">{{ row.status === 'active' ? '启用' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="380" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button text type="warning" @click="openBindPeriods(row)">绑定收费期</el-button>
          <el-button text type="success" @click="openImport(row)">导入学生</el-button>
          <el-button text type="danger" @click="onDelete(row)">删除</el-button>
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

    <!-- 项目新增/编辑：直接选校区、直接输入价格、可同时绑定收费期 -->
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑收费项目' : '新增收费项目'" width="600px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="form.name" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="所属校区" prop="campusId">
          <el-select v-model="form.campusId" placeholder="请选择校区" style="width: 100%" :disabled="!!editing"
            @change="onFormCampusChange">
            <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <div v-if="editing" class="form-tip">所属校区创建后不可变更，如需换校区请新建项目</div>
        </el-form-item>
        <el-form-item label="价格(元)" prop="amountYuan">
          <el-input-number v-model="form.amountYuan" :min="0.01" :precision="2" :step="100" style="width: 100%" />
        </el-form-item>
        <el-form-item label="绑定收费期">
          <el-select ref="formPeriodSelect" v-model="form.feePeriodIds" multiple filterable
            :placeholder="form.campusId ? '选择本校区的收费期（可多选）' : '请先选择所属校区'"
            :disabled="!form.campusId" style="width: 100%" @change="formPeriodSelect?.blur()">
            <el-option v-for="p in campusPeriods" :key="p.id" :label="`${p.name} (${p.code})`" :value="p.id" />
          </el-select>
          <div class="form-tip">仅显示所选校区的收费期；账单只会对已绑定的收费期生成</div>
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

    <!-- 绑定收费期 -->
    <el-dialog v-model="bindVisible" :title="`绑定收费期 — ${bindItem?.name ?? ''}`" width="560px">
      <el-alert type="info" :closable="false" class="mb">
        该收费项目仅对已绑定的收费期生成账单；不绑定则不会出现在任何收费期的账单中。仅可绑定「{{ bindItemCampusName }}」的收费期。
      </el-alert>
      <el-select ref="bindPeriodSelect" v-model="bindPeriodIds" multiple filterable
        placeholder="选择适用的收费期" style="width: 100%" @change="bindPeriodSelect?.blur()">
        <el-option v-for="p in bindCampusPeriods" :key="p.id" :label="`${p.name} (${p.code})`" :value="p.id" />
      </el-select>
      <template #footer>
        <el-button @click="bindVisible = false">取消</el-button>
        <el-button type="primary" :loading="bindSubmitting" @click="onBindSubmit">保存绑定</el-button>
      </template>
    </el-dialog>

    <!-- 项目内导入学生（导入即分班） -->
    <el-dialog v-model="importVisible" :title="`导入学生 — ${importItem?.name ?? ''}`" width="720px" @close="resetImport">
      <el-steps :active="importStep" finish-status="success" class="mb">
        <el-step title="上传文件" />
        <el-step title="预览校验" />
        <el-step title="确认导入" />
        <el-step title="完成" />
      </el-steps>

      <div v-if="importStep === 0">
        <el-alert type="info" :closable="false" class="mb">
          导入的学生将自动绑定到「{{ importItem?.name }}」（{{ importItemCampusName }}），无需填写校区或项目编码。
          去重标准为「手机号 + 姓名」：名单中已存在的学生将自动转入本项目，不存在的将新建。
        </el-alert>
        <el-button type="primary" link @click="downloadImportTemplate">下载导入模板(CSV)</el-button>
        <el-upload drag :auto-upload="false" accept=".xlsx,.xls,.csv" :limit="1" :on-change="onImportFileChange"
          :on-remove="onImportFileRemove" class="upload-area">
          <div class="el-upload__text">将 Excel 文件拖到此处，或 <em>点击选择</em></div>
          <template #tip>
            <div class="el-upload__tip">模板仅 3 列：姓名*、家长手机号*、班级/年级。手机号用于学生登录，请确保准确。</div>
          </template>
        </el-upload>
        <div class="step-actions">
          <el-button type="primary" :loading="uploading" :disabled="!importFile" @click="doImportUpload">上传并校验</el-button>
        </div>
      </div>

      <div v-if="importStep === 1">
        <el-descriptions :column="3" border class="mb">
          <el-descriptions-item label="总行数">{{ job?.totalRows ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="有效行">{{ job?.validRows ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="错误行">{{ job?.errorRows ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="将新增">{{ job?.newRows ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="将更新(转入本项目)">{{ job?.updateRows ?? 0 }}</el-descriptions-item>
        </el-descriptions>
        <el-alert v-if="(job?.errorRows ?? 0) > 0" type="warning" :closable="false" class="mb">
          有 {{ job?.errorRows }} 行存在错误，错误行将被跳过；可下载错误报告查看详情。
        </el-alert>
        <el-table v-if="jobErrors.length" :data="jobErrors" border max-height="260">
          <el-table-column prop="row" label="行号" width="80" />
          <el-table-column prop="message" label="错误说明" />
        </el-table>
        <el-empty v-else description="全部数据校验通过" />
        <div class="step-actions">
          <el-button @click="importStep = 0">重新上传</el-button>
          <el-button type="primary" :disabled="(job?.validRows ?? 0) === 0" @click="importStep = 2">下一步</el-button>
        </div>
      </div>

      <div v-if="importStep === 2">
        <p>即将为「{{ importItem?.name }}」导入 <strong>{{ job?.validRows ?? 0 }}</strong> 条有效记录：
          新增 <strong>{{ job?.newRows ?? 0 }}</strong> 人，转入本项目 <strong>{{ job?.updateRows ?? 0 }}</strong> 人，错误行将被跳过。</p>
        <div class="step-actions">
          <el-button @click="importStep = 1">返回预览</el-button>
          <el-button type="primary" :loading="committing" @click="doImportCommit">确认导入</el-button>
        </div>
      </div>

      <div v-if="importStep === 3">
        <el-result icon="success" title="导入完成"
          :sub-title="`新增 ${commitResult.imported} 人，转入本项目 ${commitResult.updated} 人，跳过 ${commitResult.skipped} 条`">
          <template #extra>
            <el-button v-if="(job?.errorRows ?? 0) > 0" :loading="downloadingErrors" @click="doDownloadImportErrors">
              下载错误报告
            </el-button>
            <el-button type="success" @click="goGenerateInvoices">去生成账单</el-button>
            <el-button type="primary" @click="finishImport">完成</el-button>
          </template>
        </el-result>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules, type UploadFile } from 'element-plus'
import { adminApi, toArray, toPage } from '../api/admin'
import { fenToYuan } from '../utils/format'
import type { Campus, FeeItem, FeePeriod, ImportJob } from '../api/types'
import type { NormalizedError } from '../api/client'

const router = useRouter()

const items = ref<FeeItem[]>([])
const campuses = ref<Campus[]>([])
const allPeriods = ref<FeePeriod[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const error = ref('')
const filters = reactive({ keyword: '', campusId: '', status: '' })

function campusName(id: string): string {
  return campuses.value.find((c) => c.id === id)?.name ?? '-'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [res, c, p] = await Promise.all([
      adminApi.feeItems({
        page: page.value,
        pageSize: pageSize.value,
        keyword: filters.keyword || undefined,
        campusId: filters.campusId || undefined,
        status: filters.status || undefined,
      }),
      adminApi.campuses({ pageSize: 200 }),
      adminApi.feePeriods({ pageSize: 500 }),
    ])
    items.value = toArray(res)
    total.value = toPage(res, page.value, pageSize.value).total
    campuses.value = toArray(c)
    allPeriods.value = toArray(p)
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
const formPeriodSelect = ref()
const form = reactive({
  name: '',
  campusId: '',
  amountYuan: undefined as number | undefined,
  feePeriodIds: [] as string[],
  description: '',
  status: 'active' as 'active' | 'inactive',
})
const rules: FormRules = {
  name: [
    { required: true, message: '请输入项目名称', trigger: 'blur' },
    { min: 2, max: 100, message: '名称长度 2–100 个字符', trigger: 'blur' },
  ],
  campusId: [{ required: true, message: '请选择所属校区', trigger: 'change' }],
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
}

/** 新增表单：仅显示所选校区的收费期 */
const campusPeriods = computed(() =>
  allPeriods.value.filter((p) => p.campusId === form.campusId),
)

function onFormCampusChange() {
  // 新增时：自动勾选所选校区下“开放中”的收费期（特殊情况可手动取消）
  // 编辑时校区不可变更，此处仅新增流程触发
  form.feePeriodIds = allPeriods.value
    .filter((p) => p.campusId === form.campusId && p.status === 'open')
    .map((p) => p.id)
}

function openCreate() {
  editing.value = null
  Object.assign(form, {
    name: '', campusId: '', amountYuan: undefined,
    feePeriodIds: [] as string[], description: '', status: 'active' as const,
  })
  dialogVisible.value = true
}

async function openEdit(row: FeeItem) {
  editing.value = row
  Object.assign(form, {
    name: row.name,
    campusId: row.campusId,
    amountYuan: row.amountFen != null ? row.amountFen / 100 : undefined,
    feePeriodIds: [] as string[],
    description: row.description ?? '',
    status: row.status,
  })
  dialogVisible.value = true
  try {
    const bound = await adminApi.feeItemPeriods(row.id)
    // 只保留仍属于本校区的绑定
    const valid = new Set(campusPeriods.value.map((p) => p.id))
    form.feePeriodIds = bound.map((p) => p.id).filter((id) => valid.has(id))
  } catch {
    /* 绑定加载失败不阻塞编辑 */
  }
}

async function onSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editing.value) {
      await adminApi.updateFeeItem(editing.value.id, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        amountFen: Math.round((form.amountYuan ?? 0) * 100),
        status: form.status,
      })
      // 编辑时如调整了绑定收费期，一并保存
      await adminApi.setFeeItemPeriods(editing.value.id, form.feePeriodIds)
      ElMessage.success('收费项目已更新')
    } else {
      await adminApi.createFeeItem({
        name: form.name.trim(),
        campusId: form.campusId,
        amountFen: Math.round((form.amountYuan ?? 0) * 100),
        description: form.description.trim() || undefined,
        feePeriodIds: form.feePeriodIds,
      })
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

async function onDelete(row: FeeItem) {
  try {
    await ElMessageBox.confirm(
      `确定删除收费项目「${row.name}」吗？已有学生绑定或账单引用时不可删除。`,
      '确认删除',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await adminApi.deleteFeeItem(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '删除失败')
  }
}

// ---------- 绑定收费期 ----------
const bindVisible = ref(false)
const bindSubmitting = ref(false)
const bindItem = ref<FeeItem | null>(null)
const bindPeriodIds = ref<string[]>([])
const bindPeriodSelect = ref()
const bindItemCampusName = computed(() =>
  bindItem.value ? bindItem.value.campus?.name ?? campusName(bindItem.value.campusId) : '',
)
const bindCampusPeriods = computed(() =>
  bindItem.value ? allPeriods.value.filter((p) => p.campusId === bindItem.value!.campusId) : [],
)

async function openBindPeriods(row: FeeItem) {
  bindItem.value = row
  bindPeriodIds.value = []
  bindVisible.value = true
  try {
    const bound = await adminApi.feeItemPeriods(row.id)
    bindPeriodIds.value = bound.map((p) => p.id)
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '加载收费期失败')
  }
}

async function onBindSubmit() {
  if (!bindItem.value) return
  bindSubmitting.value = true
  try {
    await adminApi.setFeeItemPeriods(bindItem.value.id, bindPeriodIds.value)
    ElMessage.success('绑定已保存')
    bindVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '保存失败')
  } finally {
    bindSubmitting.value = false
  }
}

// ---------- 项目内导入学生（导入即分班） ----------
const importVisible = ref(false)
const importStep = ref(0)
const importItem = ref<FeeItem | null>(null)
const importFile = ref<File | null>(null)
const uploading = ref(false)
const committing = ref(false)
const downloadingErrors = ref(false)
const job = ref<ImportJob | null>(null)
const commitResult = ref({ imported: 0, updated: 0, skipped: 0 })

const importItemCampusName = computed(() =>
  importItem.value ? importItem.value.campus?.name ?? campusName(importItem.value.campusId) : '',
)
const jobErrors = computed(() => job.value?.errors ?? [])

function openImport(row: FeeItem) {
  importItem.value = row
  resetImport()
  importVisible.value = true
}

function resetImport() {
  importStep.value = 0
  importFile.value = null
  job.value = null
  commitResult.value = { imported: 0, updated: 0, skipped: 0 }
}

function downloadImportTemplate() {
  // 与后端 FEE_ITEM_IMPORT_HEADERS 一致：姓名*、家长手机号*、班级/年级
  const csv = '﻿姓名*,家长手机号*,班级/年级\n张三,13800001111,高一(3)班\n'
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `学生导入模板-${importItem.value?.name ?? ''}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function onImportFileChange(file: UploadFile) {
  importFile.value = file.raw ?? null
}

function onImportFileRemove() {
  importFile.value = null
}

async function doImportUpload() {
  if (!importItem.value || !importFile.value) return
  uploading.value = true
  try {
    job.value = await adminApi.uploadFeeItemImport(importItem.value.id, importFile.value)
    importStep.value = 1
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '上传失败')
  } finally {
    uploading.value = false
  }
}

async function doImportCommit() {
  if (!job.value) return
  committing.value = true
  try {
    commitResult.value = await adminApi.commitImport(job.value.id)
    importStep.value = 3
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '导入失败')
  } finally {
    committing.value = false
  }
}

async function doDownloadImportErrors() {
  if (!job.value) return
  downloadingErrors.value = true
  try {
    const blob = await adminApi.importErrors(job.value.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `导入错误报告-${importItem.value?.name ?? ''}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '下载失败')
  } finally {
    downloadingErrors.value = false
  }
}

function finishImport() {
  importVisible.value = false
}

/** 导入完成后跳账单生成：预选校区；若项目仅绑定一个开放中的收费期则一并预选 */
async function goGenerateInvoices() {
  if (!importItem.value) return
  const query: Record<string, string> = { generate: '1', campusId: importItem.value.campusId }
  try {
    const periods = await adminApi.feeItemPeriods(importItem.value.id)
    const open = periods.filter((p) => p.status === 'open')
    if (open.length === 1) query.feePeriodId = open[0].id
  } catch {
    /* 收费期加载失败不阻塞跳转 */
  }
  importVisible.value = false
  router.push({ name: 'invoices', query })
}

load()
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
}
.amount {
  color: #1677ff;
  font-weight: 600;
}
.text-muted {
  color: #909399;
  font-size: 13px;
}
.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.5;
}
.step-actions {
  margin-top: 16px;
  text-align: right;
}
.upload-area {
  margin-top: 12px;
}
.mt {
  margin-top: 12px;
}
</style>
