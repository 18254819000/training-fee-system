<template>
  <div class="page-card">
    <div class="toolbar">
      <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 150px" @change="load">
        <el-option label="申请中" value="applying" />
        <el-option label="已批准" value="approved" />
        <el-option label="提交中" value="submitting" />
        <el-option label="处理中" value="processing" />
        <el-option label="退款成功" value="success" />
        <el-option label="退款失败" value="failed" />
        <el-option label="已关闭" value="closed" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <div class="spacer" />
      <el-button type="warning" @click="applyVisible = true">新建退款申请</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />
    <el-alert type="warning" :closable="false" class="mb">
      一期仅支持全额退款;退款请求提交成功不等于退款最终成功,以微信退款通知或服务端查单结果为准;重复提交不会重复退款。
    </el-alert>

    <el-table v-loading="loading" :data="items" border>
      <el-table-column prop="refundNo" label="退款单号" width="180" />
      <el-table-column label="原商户订单号" width="190">
        <template #default="{ row }">{{ row.outTradeNo ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="退款金额(元)" width="120" align="right">
        <template #default="{ row }"><span class="amount">{{ fenToYuan(row.amountFen) }}</span></template>
      </el-table-column>
      <el-table-column prop="reason" label="原因" min-width="160" show-overflow-tooltip />
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="refundTagType(row.status)">{{ statusText(REFUND_STATUS_TEXT, row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="微信退款单号" width="190">
        <template #default="{ row }">{{ row.wechatRefundId ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="申请时间" width="165">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'approved'" text type="primary" :loading="submittingId === row.id"
            @click="onSubmit(row)">提交微信</el-button>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="!loading && !error" description="暂无退款记录" />
      </template>
    </el-table>

    <div class="pagination-bar">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total"
        :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
    </div>

    <!-- 新建退款申请 -->
    <el-dialog v-model="applyVisible" title="新建退款申请(全额)" width="560px">
      <el-form ref="applyFormRef" :model="applyForm" :rules="applyRules" label-width="110px">
        <el-form-item label="商户订单号" prop="outTradeNo">
          <el-input v-model="applyForm.outTradeNo" placeholder="已支付订单的商户订单号" />
        </el-form-item>
        <el-form-item label="退款原因" prop="reason">
          <el-input v-model="applyForm.reason" type="textarea" :rows="3" maxlength="200" show-word-limit
            placeholder="请填写退款原因,将记入审计日志" />
        </el-form-item>
        <el-alert type="info" :closable="false">
          系统将自动校验:原订单已支付、尚未全额退款;退款金额为订单全额,原路返回。
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="applyVisible = false">取消</el-button>
        <el-button type="primary" :loading="applyLoading" @click="doApply">提交申请</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { adminApi, toArray } from '../api/admin'
import type { Refund } from '../api/types'
import { REFUND_STATUS_TEXT, fenToYuan, formatDateTime, statusText } from '../utils/format'
import type { NormalizedError } from '../api/client'

const items = ref<Refund[]>([])
const loading = ref(false)
const error = ref('')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const filters = ref({ status: '' })

const applyVisible = ref(false)
const applyLoading = ref(false)
const applyFormRef = ref<FormInstance>()
const applyForm = reactive({ outTradeNo: '', reason: '' })
const applyRules: FormRules = {
  outTradeNo: [{ required: true, message: '请填写商户订单号', trigger: 'blur' }],
  reason: [
    { required: true, message: '请填写退款原因', trigger: 'blur' },
    { min: 4, message: '原因至少 4 个字', trigger: 'blur' },
  ],
}
const submittingId = ref<string | null>(null)

function refundTagType(s: Refund['status']): string {
  if (s === 'success') return 'success'
  if (s === 'failed') return 'danger'
  if (s === 'closed') return 'info'
  return 'warning'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await adminApi.refunds({
      page: page.value,
      pageSize: pageSize.value,
      status: filters.value.status || undefined,
    })
    const arr = toArray(res)
    items.value = arr
    total.value = Array.isArray(res) ? arr.length : (res as { total: number }).total
  } catch (e) {
    error.value = (e as NormalizedError).message
  } finally {
    loading.value = false
  }
}

/**
 * 新建退款申请。
 * 契约说明:PRD §9.2 的 POST /admin/refunds 入参为 paymentOrderId;
 * 此处按商户订单号查找已支付订单后再提交,若后端支持按 outTradeNo 可简化,见 README。
 */
async function doApply() {
  const form = applyFormRef.value
  if (!form) return
  await form.validate(async (valid) => {
    if (!valid) return
    applyLoading.value = true
    try {
      const orders = toArray(
        await adminApi.paymentOrders({ keyword: applyForm.outTradeNo, status: 'paid', pageSize: 5 }),
      )
      const order = orders.find((o) => o.outTradeNo === applyForm.outTradeNo)
      if (!order) {
        ElMessage.error('未找到该商户订单号对应的已支付订单')
        return
      }
      await adminApi.createRefund({
        paymentOrderId: order.id,
        amountFen: order.amountFen,
        reason: applyForm.reason,
      })
      ElMessage.success('退款申请已创建')
      applyVisible.value = false
      applyForm.outTradeNo = ''
      applyForm.reason = ''
      load()
    } catch (e) {
      ElMessage.error((e as NormalizedError).message)
    } finally {
      applyLoading.value = false
    }
  })
}

async function onSubmit(row: Refund) {
  submittingId.value = row.id
  try {
    const updated = await adminApi.submitRefund(row.id)
    const idx = items.value.findIndex((r) => r.id === row.id)
    if (idx >= 0) items.value[idx] = updated
    ElMessage.success('已提交微信,等待退款结果通知')
  } catch (e) {
    ElMessage.error((e as NormalizedError).message)
  } finally {
    submittingId.value = null
  }
}

onMounted(load)
</script>

<style scoped>
.muted {
  color: #a8abb2;
}
</style>
