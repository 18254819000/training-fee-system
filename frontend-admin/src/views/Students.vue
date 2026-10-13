<template>
  <div class="page-card">
    <div class="toolbar">
      <el-input v-model="filters.keyword" placeholder="按姓名/学号搜索" clearable style="width: 220px" @change="load" />
      <el-select v-model="filters.campusId" placeholder="全部校区" clearable style="width: 170px" @change="load">
        <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 130px" @change="load">
        <el-option label="在读" value="active" />
        <el-option label="停用" value="inactive" />
        <el-option label="离校" value="left" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <div class="spacer" />
      <el-button type="success" @click="importVisible = true">Excel 导入</el-button>
      <el-button type="primary" @click="openCreate">新增学生</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />

    <el-table v-loading="loading" :data="items" border>
      <el-table-column prop="studentNo" label="内部学号" width="130" />
      <el-table-column prop="name" label="姓名" width="120" />
      <el-table-column label="校区" width="150">
        <template #default="{ row }">{{ row.campusName ?? campusName(row.campusId) }}</template>
      </el-table-column>
      <el-table-column prop="gradeOrClass" label="班级/年级" width="140" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : row.status === 'left' ? 'warning' : 'info'">
            {{ studentStatusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status === 'active'" text type="warning" @click="toggleStatus(row, 'inactive')">停用</el-button>
          <el-button v-if="row.status !== 'active'" text type="success" @click="toggleStatus(row, 'active')">启用</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="!loading && !error" description="暂无学生数据" />
      </template>
    </el-table>

    <div class="pagination-bar">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total"
        :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
    </div>

    <!-- 新增/编辑学生 -->
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑学生' : '新增学生'" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="姓名" prop="name">
          <el-input v-model="form.name" maxlength="100" />
        </el-form-item>
        <el-form-item label="内部学号" prop="studentNo">
          <el-input v-model="form.studentNo" maxlength="64" placeholder="可选,按学校规则唯一" />
        </el-form-item>
        <el-form-item label="校区" prop="campusId">
          <el-select v-model="form.campusId" placeholder="请选择校区" style="width: 100%">
            <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="班级/年级" prop="gradeOrClass">
          <el-input v-model="form.gradeOrClass" maxlength="100" />
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="在读" value="active" />
            <el-option label="停用" value="inactive" />
            <el-option label="离校" value="left" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>

    <!-- Excel 导入:上传 → 预览 → 确认导入 → 下载错误报告 -->
    <el-dialog v-model="importVisible" title="Excel 导入学生" width="720px" @close="resetImport">
      <el-steps :active="importStep" finish-status="success" class="mb">
        <el-step title="上传文件" />
        <el-step title="预览校验" />
        <el-step title="确认导入" />
        <el-step title="完成" />
      </el-steps>

      <div v-if="importStep === 0">
        <el-button type="primary" link @click="downloadTemplate">下载导入模板(CSV)</el-button>
        <el-upload drag :auto-upload="false" accept=".xlsx,.xls,.csv" :limit="1" :on-change="onFileChange"
          :on-remove="onFileRemove" class="upload-area">
          <div class="el-upload__text">将 Excel 文件拖到此处,或 <em>点击选择</em></div>
          <template #tip>
            <div class="el-upload__tip">支持 .xlsx/.xls/.csv,建议字段:姓名(必填)、校区编码(必填)、班级/年级、家长手机号、内部学号</div>
          </template>
        </el-upload>
        <div class="step-actions">
          <el-button type="primary" :loading="uploading" :disabled="!importFile" @click="doUpload">上传并校验</el-button>
        </div>
      </div>

      <div v-if="importStep === 1">
        <el-descriptions :column="3" border class="mb">
          <el-descriptions-item label="总行数">{{ job?.totalRows ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="有效行">{{ job?.validRows ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="错误行">{{ job?.errorRows ?? 0 }}</el-descriptions-item>
        </el-descriptions>
        <el-alert v-if="(job?.errorRows ?? 0) > 0" type="warning" :closable="false" class="mb">
          有 {{ job?.errorRows }} 行存在错误,错误行将被跳过;可下载错误报告查看详情。
        </el-alert>
        <el-table v-if="jobErrors.length" :data="jobErrors" border max-height="260">
          <el-table-column prop="row" label="行号" width="80" />
          <el-table-column prop="field" label="字段" width="140" />
          <el-table-column prop="message" label="错误说明" />
        </el-table>
        <el-empty v-else description="全部数据校验通过" />
        <div class="step-actions">
          <el-button @click="importStep = 0">重新上传</el-button>
          <el-button type="primary" :disabled="(job?.validRows ?? 0) === 0" @click="importStep = 2">下一步</el-button>
        </div>
      </div>

      <div v-if="importStep === 2">
        <p>即将导入 <strong>{{ job?.validRows ?? 0 }}</strong> 条有效学生记录,错误行将被跳过。</p>
        <div class="step-actions">
          <el-button @click="importStep = 1">返回预览</el-button>
          <el-button type="primary" :loading="committing" @click="doCommit">确认导入</el-button>
        </div>
      </div>

      <div v-if="importStep === 3">
        <el-result icon="success" title="导入完成"
          :sub-title="`成功导入 ${commitResult.imported} 条,跳过 ${commitResult.skipped} 条`">
          <template #extra>
            <el-button v-if="(job?.errorRows ?? 0) > 0" :loading="downloadingErrors" @click="doDownloadErrors">
              下载错误报告
            </el-button>
            <el-button type="primary" @click="finishImport">完成</el-button>
          </template>
        </el-result>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules, type UploadFile } from 'element-plus'
import { adminApi, toArray, toPage } from '../api/admin'
import { formatDateTime } from '../utils/format'
import type { Campus, ImportJob, Student, StudentStatus } from '../api/types'
import type { NormalizedError } from '../api/client'

const STUDENT_STATUS_TEXT: Record<StudentStatus, string> = { active: '在读', inactive: '停用', left: '离校' }
const studentStatusText = (s: StudentStatus) => STUDENT_STATUS_TEXT[s] ?? s

const items = ref<Student[]>([])
const campuses = ref<Campus[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const error = ref('')
const filters = reactive({ keyword: '', campusId: '', status: '' })

const dialogVisible = ref(false)
const editing = ref<Student | null>(null)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({ name: '', studentNo: '', campusId: '', gradeOrClass: '', status: 'active' as StudentStatus })
const rules: FormRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  campusId: [{ required: true, message: '请选择校区', trigger: 'change' }],
}

function campusName(id: string): string {
  return campuses.value.find((c) => c.id === id)?.name ?? '-'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [res, c] = await Promise.all([
      adminApi.students({
        page: page.value,
        pageSize: pageSize.value,
        keyword: filters.keyword || undefined,
        campusId: filters.campusId || undefined,
        status: filters.status || undefined,
      }),
      adminApi.campuses({ pageSize: 200 }),
    ])
    items.value = toArray(res)
    total.value = toPage(res, page.value, pageSize.value).total
    campuses.value = toArray(c)
  } catch (e) {
    error.value = (e as NormalizedError).message || '加载学生列表失败'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', studentNo: '', campusId: '', gradeOrClass: '', status: 'active' as StudentStatus })
  dialogVisible.value = true
}

function openEdit(row: Student) {
  editing.value = row
  Object.assign(form, {
    name: row.name,
    studentNo: row.studentNo ?? '',
    campusId: row.campusId,
    gradeOrClass: row.gradeOrClass ?? '',
    status: row.status,
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
      studentNo: form.studentNo.trim() || undefined,
      campusId: form.campusId,
      gradeOrClass: form.gradeOrClass.trim() || undefined,
      status: form.status,
    }
    if (editing.value) {
      await adminApi.updateStudent(editing.value.id, payload)
      ElMessage.success('学生已更新')
    } else {
      await adminApi.createStudent(payload)
      ElMessage.success('学生已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '保存失败')
  } finally {
    submitting.value = false
  }
}

// 有历史账单的学生只停用不删除
async function toggleStatus(row: Student, status: StudentStatus) {
  const action = status === 'active' ? '启用' : '停用'
  try {
    await ElMessageBox.confirm(`确定${action}学生「${row.name}」吗?`, '确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await adminApi.updateStudent(row.id, { status })
    ElMessage.success(`已${action}`)
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '操作失败')
  }
}

// ---------- Excel 导入 ----------
const importVisible = ref(false)
const importStep = ref(0)
const importFile = ref<File | null>(null)
const uploading = ref(false)
const committing = ref(false)
const downloadingErrors = ref(false)
const job = ref<ImportJob | null>(null)
const jobErrors = ref<Array<{ row: number; field?: string; message: string }>>([])
const commitResult = ref({ imported: 0, skipped: 0 })

function resetImport() {
  importStep.value = 0
  importFile.value = null
  job.value = null
  jobErrors.value = []
  commitResult.value = { imported: 0, skipped: 0 }
}

// 模板为客户端生成的 CSV(若后端提供官方模板接口,改为调用该接口)
function downloadTemplate() {
  const header = '姓名,校区编码,班级/年级,家长手机号,内部学号\n'
  const sample = '张三,BJ01,高一(3)班,13800000000,XS2026001\n'
  const blob = new Blob(['\uFEFF' + header + sample], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '学生导入模板.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function onFileChange(file: UploadFile) {
  importFile.value = file.raw ?? null
}
function onFileRemove() {
  importFile.value = null
}

async function doUpload() {
  if (!importFile.value) return
  uploading.value = true
  try {
    const created = await adminApi.createImportJob(importFile.value)
    const preview = await adminApi.importJob(created.id)
    job.value = preview
    jobErrors.value = preview.errors ?? []
    importStep.value = 1
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '上传失败')
  } finally {
    uploading.value = false
  }
}

async function doCommit() {
  if (!job.value) return
  committing.value = true
  try {
    const res = await adminApi.commitImport(job.value.id)
    commitResult.value = { imported: res.imported, skipped: res.skipped }
    importStep.value = 3
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '导入失败')
  } finally {
    committing.value = false
  }
}

async function doDownloadErrors() {
  if (!job.value) return
  downloadingErrors.value = true
  try {
    const blob = await adminApi.importErrors(job.value.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `学生导入错误报告-${job.value.fileName || job.value.id}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '下载错误报告失败')
  } finally {
    downloadingErrors.value = false
  }
}

function finishImport() {
  importVisible.value = false
  load()
}

load()
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
}

.upload-area {
  margin-top: 12px;
}

.step-actions {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
