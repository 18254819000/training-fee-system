<template>
  <div class="page-card">
    <el-alert type="info" :closable="false" class="mb">
      登录码采用密码学安全随机数生成,数据库仅保存哈希;明文只在签发时展示一次,不会再次显示。请务必及时打印或保存。
    </el-alert>

    <div class="toolbar">
      <el-select v-model="filters.studentId" placeholder="按学生筛选" clearable filterable style="width: 220px" @change="load">
        <el-option v-for="s in students" :key="s.id" :label="`${s.name}${s.studentNo ? `(${s.studentNo})` : ''}`"
          :value="s.id" />
      </el-select>
      <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 140px" @change="load">
        <el-option label="有效" value="active" />
        <el-option label="已使用" value="used" />
        <el-option label="已过期" value="expired" />
        <el-option label="已撤销" value="revoked" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <div class="spacer" />
      <el-button type="primary" @click="openIssue">批量签发登录码</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />

    <el-table v-loading="loading" :data="items" border>
      <el-table-column label="学生" width="140">
        <template #default="{ row }">{{ row.studentName ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="codeTagType(row.status)">{{ statusText(LOGIN_CODE_STATUS_TEXT, row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="有效期至" width="170">
        <template #default="{ row }">{{ formatDateTime(row.expiresAt) }}</template>
      </el-table-column>
      <el-table-column label="使用时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.usedAt) }}</template>
      </el-table-column>
      <el-table-column prop="failedAttempts" label="失败次数" width="100" />
      <el-table-column label="签发时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'active'" text type="warning" @click="onRevoke(row)">撤销</el-button>
          <el-button text type="primary" @click="onReissue(row)">重新签发</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="!loading && !error" description="暂无登录码记录" />
      </template>
    </el-table>

    <div class="pagination-bar">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total"
        :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
    </div>

    <!-- 批量签发 -->
    <el-dialog v-model="issueVisible" title="批量签发登录码" width="600px">
      <el-form ref="issueFormRef" :model="issueForm" :rules="issueRules" label-width="96px">
        <el-form-item label="选择学生" prop="studentIds">
          <el-select ref="loginCodeStudentSelect" v-model="issueForm.studentIds" multiple filterable placeholder="选择要签发的学生" style="width: 100%" @change="loginCodeStudentSelect?.blur()">
            <el-option v-for="s in students" :key="s.id" :label="`${s.name}${s.studentNo ? `(${s.studentNo})` : ''}`"
              :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="有效期至" prop="expiresAt">
          <el-date-picker v-model="issueForm.expiresAt" type="datetime" placeholder="选择有效期"
            value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%" />
        </el-form-item>
      </el-form>
      <el-alert type="warning" :closable="false" class="mb">
        签发将撤销该学生此前未使用的登录码;明文码仅在签发成功后展示一次。
      </el-alert>
      <template #footer>
        <el-button @click="issueVisible = false">取消</el-button>
        <el-button type="primary" :loading="issuing" @click="doIssue">签发</el-button>
      </template>
    </el-dialog>

    <!-- 签发成功:明文码仅展示一次 -->
    <el-dialog v-model="resultVisible" title="签发成功 — 请立即打印或保存" width="640px" :close-on-click-modal="false"
      :close-on-press-escape="false" :show-close="false">
      <el-alert type="warning" :closable="false" class="mb">
        以下登录码明文只显示一次,关闭本窗口后将无法再次查看。请立即打印并发放给家长。
      </el-alert>
      <el-table :data="issuedCodes" border max-height="320">
        <el-table-column prop="studentName" label="学生" width="140" />
        <el-table-column prop="code" label="登录码">
          <template #default="{ row }"><strong class="code-text">{{ row.code }}</strong></template>
        </el-table-column>
        <el-table-column label="有效期至" width="170">
          <template #default="{ row }">{{ formatDateTime(row.expiresAt) }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="doPrint">打印</el-button>
        <el-button type="primary" @click="closeResult">我已保存,关闭</el-button>
      </template>
    </el-dialog>

    <!-- 打印专用区域(打印样式控制只显示该区域) -->
    <div id="print-codes" class="print-only">
      <h2>学生登录码发放单</h2>
      <p>签发时间:{{ formatDateTime(nowIso) }} · 共 {{ issuedCodes.length }} 条 · 请妥善保管,登录码仅可使用一次</p>
      <table class="print-table">
        <thead>
          <tr><th>学生</th><th>登录码</th><th>有效期至</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in issuedCodes" :key="c.studentId">
            <td>{{ c.studentName }}</td>
            <td class="print-code">{{ c.code }}</td>
            <td>{{ formatDateTime(c.expiresAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { adminApi, toArray, toPage } from '../api/admin'
import { LOGIN_CODE_STATUS_TEXT, formatDateTime, statusText } from '../utils/format'
import type { LoginCode, Student } from '../api/types'
import type { NormalizedError } from '../api/client'
const loginCodeStudentSelect = ref()

interface IssuedCode {
  studentId: string
  studentName: string
  code: string
  expiresAt: string
}

const items = ref<LoginCode[]>([])
const students = ref<Student[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const error = ref('')
const filters = reactive({ studentId: '', status: '' })
const nowIso = ref(new Date().toISOString())

function codeTagType(status: string): 'success' | 'info' | 'warning' | 'danger' {
  return status === 'active' ? 'success' : status === 'used' ? 'info' : status === 'expired' ? 'warning' : 'danger'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [res, s] = await Promise.all([
      adminApi.loginCodes({
        page: page.value,
        pageSize: pageSize.value,
        studentId: filters.studentId || undefined,
        status: filters.status || undefined,
      }),
      adminApi.students({ pageSize: 500, status: 'active' }),
    ])
    items.value = toArray(res)
    total.value = toPage(res, page.value, pageSize.value).total
    students.value = toArray(s)
  } catch (e) {
    error.value = (e as NormalizedError).message || '加载登录码失败'
  } finally {
    loading.value = false
  }
}

// ---------- 签发 ----------
const issueVisible = ref(false)
const issueFormRef = ref<FormInstance>()
const issueForm = reactive({ studentIds: [] as string[], expiresAt: '' })
const issueRules: FormRules = {
  studentIds: [{ required: true, message: '请选择学生', trigger: 'change' }],
  expiresAt: [{ required: true, message: '请设置有效期', trigger: 'change' }],
}
const issuing = ref(false)
const resultVisible = ref(false)
const issuedCodes = ref<IssuedCode[]>([])

function openIssue(studentIds: string[] = []) {
  issueForm.studentIds = studentIds
  issueForm.expiresAt = ''
  issueVisible.value = true
}

async function doIssue() {
  const valid = await issueFormRef.value?.validate().catch(() => false)
  if (!valid) return
  issuing.value = true
  try {
    const res = await adminApi.batchLoginCodes(issueForm.studentIds, issueForm.expiresAt)
    issuedCodes.value = res.codes ?? []
    nowIso.value = new Date().toISOString()
    issueVisible.value = false
    resultVisible.value = true
    if (issuedCodes.value.length === 0) {
      ElMessage.warning('签发成功,但未返回明文码;请确认后端已实现一次性明文返回')
    }
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '签发失败')
  } finally {
    issuing.value = false
  }
}

function doPrint() {
  window.print()
}

function closeResult() {
  // 明文码仅展示一次:关闭即丢弃,不做任何本地存储
  issuedCodes.value = []
  resultVisible.value = false
}

async function onRevoke(row: LoginCode) {
  try {
    await ElMessageBox.confirm(`确定撤销该登录码吗?撤销后将立即失效。`, '确认撤销', { type: 'warning' })
  } catch {
    return
  }
  try {
    await adminApi.revokeLoginCode(row.id)
    ElMessage.success('登录码已撤销')
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '撤销失败')
  }
}

function onReissue(row: LoginCode) {
  openIssue([row.studentId])
}

load()
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
}

.code-text {
  font-family: ui-monospace, Consolas, monospace;
  letter-spacing: 1px;
  user-select: all;
}

/* 打印样式:只打印发放单区域 */
.print-only {
  display: none;
}

@media print {
  body * {
    visibility: hidden;
  }

  .print-only,
  .print-only * {
    visibility: visible;
  }

  .print-only {
    display: block;
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    padding: 24px;
    color: #000;
  }

  .print-table {
    width: 100%;
    border-collapse: collapse;
  }

  .print-table th,
  .print-table td {
    border: 1px solid #000;
    padding: 8px 12px;
    text-align: left;
  }

  .print-code {
    font-family: ui-monospace, Consolas, monospace;
    font-size: 16px;
    letter-spacing: 2px;
  }
}
</style>
