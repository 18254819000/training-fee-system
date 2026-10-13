<template>
  <div class="page-card">
    <div class="toolbar">
      <el-input v-model="filters.keyword" placeholder="按账单号/学生搜索" clearable style="width: 220px" @change="load" />
      <el-select v-model="filters.campusId" placeholder="全部校区" clearable style="width: 170px" @change="load">
        <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select v-model="filters.feePeriodId" placeholder="全部收费期" clearable style="width: 190px" @change="load">
        <el-option v-for="p in feePeriods" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
      <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 140px" @change="load">
        <el-option label="待支付" value="pending" />
        <el-option label="支付处理中" value="processing" />
        <el-option label="已支付" value="paid" />
        <el-option label="退款处理中" value="refunding" />
        <el-option label="已退款" value="refunded" />
        <el-option label="已作废" value="voided" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <div class="spacer" />
      <el-button type="success" @click="genVisible = true">生成账单</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />

    <el-table v-loading="loading" :data="items" border>
      <el-table-column prop="invoiceNo" label="账单号" width="170" />
      <el-table-column label="学生" width="120">
        <template #default="{ row }">{{ row.studentName ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="校区" width="140">
        <template #default="{ row }">{{ row.campusName ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="收费期" width="150">
        <template #default="{ row }">{{ row.feePeriodName ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="应收(元)" width="110" align="right">
        <template #default="{ row }"><span class="amount">{{ fenToYuan(row.amountDueFen) }}</span></template>
      </el-table-column>
      <el-table-column label="已付(元)" width="110" align="right">
        <template #default="{ row }"><span class="amount">{{ fenToYuan(row.amountPaidFen) }}</span></template>
      </el-table-column>
      <el-table-column label="待付(元)" width="110" align="right">
        <template #default="{ row }"><span class="amount">{{ fenToYuan(row.amountDueFen - row.amountPaidFen) }}</span></template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="invoiceTagType(row.status)">{{ statusText(INVOICE_STATUS_TEXT, row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" @click="openDetail(row)">详情</el-button>
          <el-button v-if="row.status === 'pending'" text type="danger" @click="onVoid(row)">作废</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="!loading && !error" description="暂无账单数据" />
      </template>
    </el-table>

    <div class="pagination-bar">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total"
        :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
    </div>

    <!-- 生成账单:先预览数量/总金额再确认 -->
    <el-dialog v-model="genVisible" title="生成账单" width="620px">
      <el-form ref="genFormRef" :model="genForm" :rules="genRules" label-width="110px">
        <el-form-item label="收费期" prop="feePeriodId">
          <el-select v-model="genForm.feePeriodId" placeholder="仅开放收费期可生成" style="width: 100%">
            <el-option v-for="p in openPeriods" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="校区">
          <el-select v-model="genForm.campusId" placeholder="全部校区" clearable style="width: 100%">
            <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="学生">
          <el-select v-model="genForm.studentIds" multiple filterable placeholder="不选则为筛选范围内全部学生" style="width: 100%">
            <el-option v-for="s in genStudents" :key="s.id" :label="`${s.name}${s.studentNo ? `(${s.studentNo})` : ''}`"
              :value="s.id" />
          </el-select>
        </el-form-item>
      </el-form>

      <el-card v-if="preview" shadow="never" class="preview-card">
        <el-descriptions :column="2">
          <el-descriptions-item label="将生成账单数">{{ preview.count }}</el-descriptions-item>
          <el-descriptions-item label="应收总金额(元)">
            <span class="amount">{{ fenToYuan(preview.totalFen) }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <el-alert v-if="preview.count === 0" type="warning" :closable="false" title="没有符合条件的待生成账单" />
      </el-card>

      <template #footer>
        <el-button @click="genVisible = false">取消</el-button>
        <el-button :loading="previewLoading" @click="doPreview">预览</el-button>
        <el-button type="primary" :loading="genLoading" :disabled="!preview || preview.count === 0" @click="doGenerate">
          确认生成
        </el-button>
      </template>
    </el-dialog>

    <!-- 账单详情 -->
    <el-drawer v-model="detailVisible" title="账单详情" size="600px">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="账单号">{{ detail?.invoiceNo }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ statusText(INVOICE_STATUS_TEXT, detail?.status) }}</el-descriptions-item>
        <el-descriptions-item label="学生">{{ detail?.studentName ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="校区">{{ detail?.campusName ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="收费期">{{ detail?.feePeriodName ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatDateTime(detail?.createdAt) }}</el-descriptions-item>
      </el-descriptions>
      <div class="drawer-subtitle">收费明细(价格快照)</div>
      <el-table :data="detail?.items ?? []" border>
        <el-table-column prop="itemNameSnapshot" label="项目名称" />
        <el-table-column label="单价(元)" width="110" align="right">
          <template #default="{ row }"><span class="amount">{{ fenToYuan(row.unitPriceFen) }}</span></template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="70" align="right" />
        <el-table-column label="小计(元)" width="110" align="right">
          <template #default="{ row }"><span class="amount">{{ fenToYuan(row.lineAmountFen) }}</span></template>
        </el-table-column>
      </el-table>
      <el-descriptions :column="1" border class="drawer-totals">
        <el-descriptions-item label="应收金额(元)"><span class="amount">{{ fenToYuan(detail?.amountDueFen) }}</span></el-descriptions-item>
        <el-descriptions-item label="已付金额(元)"><span class="amount">{{ fenToYuan(detail?.amountPaidFen) }}</span></el-descriptions-item>
        <el-descriptions-item label="已退金额(元)"><span class="amount">{{ fenToYuan(detail?.amountRefundedFen) }}</span></el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { adminApi, toArray, toPage } from '../api/admin'
import { INVOICE_STATUS_TEXT, fenToYuan, formatDateTime, statusText } from '../utils/format'
import type { Campus, FeePeriod, Invoice, Student } from '../api/types'
import type { NormalizedError } from '../api/client'

const items = ref<Invoice[]>([])
const campuses = ref<Campus[]>([])
const feePeriods = ref<FeePeriod[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const error = ref('')
const filters = reactive({ keyword: '', campusId: '', feePeriodId: '', status: '' })
const openPeriods = computed(() => feePeriods.value.filter((p) => p.status === 'open'))

function invoiceTagType(status: string): 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'paid') return 'success'
  if (status === 'pending') return 'info'
  if (status === 'voided') return 'danger'
  return 'warning'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [res, c, p] = await Promise.all([
      adminApi.invoices({
        page: page.value,
        pageSize: pageSize.value,
        keyword: filters.keyword || undefined,
        campusId: filters.campusId || undefined,
        feePeriodId: filters.feePeriodId || undefined,
        status: filters.status || undefined,
      }),
      adminApi.campuses({ pageSize: 200 }),
      adminApi.feePeriods({ pageSize: 200 }),
    ])
    items.value = toArray(res)
    total.value = toPage(res, page.value, pageSize.value).total
    campuses.value = toArray(c)
    feePeriods.value = toArray(p)
  } catch (e) {
    error.value = (e as NormalizedError).message || '加载账单失败'
  } finally {
    loading.value = false
  }
}

// ---------- 生成账单 ----------
const genVisible = ref(false)
const genFormRef = ref<FormInstance>()
const genForm = reactive({ feePeriodId: '', campusId: '', studentIds: [] as string[] })
const genRules: FormRules = {
  feePeriodId: [{ required: true, message: '请选择开放收费期', trigger: 'change' }],
}
const previewLoading = ref(false)
const genLoading = ref(false)
const preview = ref<{ preview: boolean; count: number; totalFen: number } | null>(null)
const genStudents = ref<Student[]>([])

watch(
  () => [genForm.feePeriodId, genForm.campusId],
  async () => {
    preview.value = null
    try {
      const s = await adminApi.students({
        pageSize: 500,
        status: 'active',
        campusId: genForm.campusId || undefined,
      })
      genStudents.value = toArray(s)
    } catch {
      genStudents.value = []
    }
  },
)

function genPayload(previewMode: boolean) {
  return {
    feePeriodId: genForm.feePeriodId,
    campusId: genForm.campusId || undefined,
    studentIds: genForm.studentIds.length ? genForm.studentIds : undefined,
    preview: previewMode,
  }
}

async function doPreview() {
  const valid = await genFormRef.value?.validate().catch(() => false)
  if (!valid) return
  previewLoading.value = true
  try {
    preview.value = await adminApi.generateInvoices(genPayload(true))
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '预览失败')
  } finally {
    previewLoading.value = false
  }
}

async function doGenerate() {
  if (!preview.value) return
  genLoading.value = true
  try {
    const res = await adminApi.generateInvoices(genPayload(false))
    ElMessage.success(`已生成 ${res.count} 张账单,应收合计 ${fenToYuan(res.totalFen)} 元`)
    genVisible.value = false
    preview.value = null
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '生成账单失败')
  } finally {
    genLoading.value = false
  }
}

// ---------- 作废 ----------
async function onVoid(row: Invoice) {
  try {
    const { value } = await ElMessageBox.prompt('请填写作废原因(将记入审计日志)', `作废账单 ${row.invoiceNo}`, {
      confirmButtonText: '确认作废',
      cancelButtonText: '取消',
      inputValidator: (v) => !!v?.trim() || '作废原因必填',
    })
    await adminApi.voidInvoice(row.id, value.trim())
    ElMessage.success('账单已作废')
    await load()
  } catch (e) {
    if ((e as NormalizedError).message) ElMessage.error((e as NormalizedError).message)
  }
}

// ---------- 详情 ----------
const detailVisible = ref(false)
const detail = ref<Invoice | null>(null)
function openDetail(row: Invoice) {
  detail.value = row
  detailVisible.value = true
}

load()
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
}

.preview-card {
  margin-top: 16px;
}

.drawer-subtitle {
  font-weight: 600;
  margin: 20px 0 12px;
}

.drawer-totals {
  margin-top: 16px;
}
</style>
