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
      <el-button type="primary" @click="openCreate">新增学生</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />

    <el-table v-loading="loading" :data="items" border>
      <el-table-column prop="studentNo" label="内部学号" width="130" />
      <el-table-column prop="name" label="姓名" width="120" />
      <el-table-column label="校区" width="150">
        <template #default="{ row }">{{ row.campusName ?? campusName(row.campusId) }}</template>
      </el-table-column>
      <el-table-column label="收费项目" width="160">
        <template #default="{ row }">{{ row.feeItemName ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="家长手机号" width="130">
        <template #default="{ row }">{{ row.guardianPhone ?? '-' }}</template>
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
          <el-input v-model="form.name" maxlength="64" placeholder="必填" />
          <div class="form-tip">同一校区内「手机号 + 姓名」不可重复（兄弟姐妹可共用家长手机号）</div>
        </el-form-item>
        <el-form-item label="内部学号" prop="studentNo">
          <el-input v-model="form.studentNo" maxlength="64" placeholder="选填，仅作备注" />
        </el-form-item>
        <el-form-item label="校区" prop="campusId">
          <el-select v-model="form.campusId" placeholder="请选择校区" style="width: 100%" @change="onFormCampusChange">
            <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="收费项目" prop="feeItemId">
          <el-select v-model="form.feeItemId" :placeholder="form.campusId ? '请选择报读的收费项目' : '请先选择校区'" clearable
            style="width: 100%" :disabled="!form.campusId">
            <el-option v-for="f in campusFeeItems" :key="f.id" :label="feeItemLabel(f)" :value="f.id" />
          </el-select>
          <div class="form-tip">仅显示所选校区的收费项目；批量导入请在「收费项目」列表中使用「导入学生」</div>
        </el-form-item>
        <el-form-item label="家长手机号" prop="guardianPhone">
          <el-input v-model="form.guardianPhone" maxlength="11"
            :placeholder="editing ? '不修改请留空' : '必填，学生端登录凭证'" />
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

  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { adminApi, toArray, toPage } from '../api/admin'
import { formatDateTime } from '../utils/format'
import type { Campus, FeeItem, Student, StudentStatus } from '../api/types'
import type { NormalizedError } from '../api/client'

const STUDENT_STATUS_TEXT: Record<StudentStatus, string> = { active: '在读', inactive: '停用', left: '离校' }
const studentStatusText = (s: StudentStatus) => STUDENT_STATUS_TEXT[s] ?? s

const items = ref<Student[]>([])
const campuses = ref<Campus[]>([])
const feeItems = ref<FeeItem[]>([])
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
const form = reactive({
  name: '', studentNo: '', campusId: '', feeItemId: '',
  guardianPhone: '', gradeOrClass: '', status: 'active' as StudentStatus,
})
const phoneRe = /^1[3-9]\d{9}$/
const rules: FormRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  campusId: [{ required: true, message: '请选择校区', trigger: 'change' }],
  feeItemId: [{ required: true, message: '请选择收费项目', trigger: 'change' }],
  guardianPhone: [
    {
      validator: (_r, v: string, cb) => {
        if (!v) {
          // 新增时必填；编辑时留空表示不修改
          return editing.value ? cb() : cb(new Error('请输入家长手机号（学生端登录凭证）'))
        }
        if (!phoneRe.test(v)) return cb(new Error('手机号格式不正确'))
        cb()
      },
      trigger: 'blur',
    },
  ],
}

/** 编辑学生时：收费项目只显示已选择校区的项目 */
const campusFeeItems = computed(() =>
  form.campusId ? feeItems.value.filter((f) => f.campusId === form.campusId) : [],
)

function onFormCampusChange() {
  // 切换校区后，清除不属于该校区的已选收费项目
  if (!campusFeeItems.value.some((f) => f.id === form.feeItemId)) {
    form.feeItemId = ''
  }
}

/** 收费项目下拉展示：名称（绑定的收费期） */
function feeItemLabel(f: FeeItem): string {
  const periods = f.feePeriods?.map((p) => p.name).join('、')
  return periods ? `${f.name}（${periods}）` : f.name
}

function campusName(id: string): string {
  return campuses.value.find((c) => c.id === id)?.name ?? '-'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [res, c, f] = await Promise.all([
      adminApi.students({
        page: page.value,
        pageSize: pageSize.value,
        keyword: filters.keyword || undefined,
        campusId: filters.campusId || undefined,
        status: filters.status || undefined,
      }),
      adminApi.campuses({ pageSize: 200 }),
      adminApi.feeItems({ pageSize: 200, status: 'active' }),
    ])
    items.value = toArray(res)
    total.value = toPage(res, page.value, pageSize.value).total
    campuses.value = toArray(c)
    feeItems.value = toArray(f)
  } catch (e) {
    error.value = (e as NormalizedError).message || '加载学生列表失败'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, {
    name: '', studentNo: '', campusId: '', feeItemId: '',
    guardianPhone: '', gradeOrClass: '', status: 'active' as StudentStatus,
  })
  dialogVisible.value = true
}

function openEdit(row: Student) {
  editing.value = row
  Object.assign(form, {
    name: row.name,
    studentNo: row.studentNo ?? '',
    campusId: row.campusId,
    feeItemId: (row as any).feeItemId ?? '',
    guardianPhone: '',
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
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      studentNo: form.studentNo.trim() || undefined,
      campusId: form.campusId,
      feeItemId: form.feeItemId || undefined,
      gradeOrClass: form.gradeOrClass.trim() || undefined,
      status: form.status,
    }
    // 编辑时手机号留空 = 不修改（列表返回的是脱敏号码，不可回填提交）
    if (form.guardianPhone.trim()) payload.guardianPhone = form.guardianPhone.trim()
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

.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.5;
}
</style>
