<template>
  <div class="page-card">
    <div class="toolbar">
      <el-alert type="info" :closable="false" class="mb" style="width: 100%">
        密钥与私钥仅在服务端处理,前端永不回显明文;所有配置变更、检查、启用与停用均记入审计日志。
      </el-alert>
      <div class="spacer" />
      <el-button type="primary" @click="openCreate">新建支付账户</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />

    <el-table v-loading="loading" :data="items" border>
      <el-table-column prop="name" label="账户名称" min-width="160" />
      <el-table-column label="环境" width="90">
        <template #default="{ row }">
          <el-tag :type="row.environment === 'production' ? 'danger' : 'info'">
            {{ row.environment === 'production' ? '正式' : '测试' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="appId" label="公众号 AppID" width="190" />
      <el-table-column prop="mchId" label="商户号 MchID" width="150" />
      <el-table-column label="适用范围" width="150">
        <template #default="{ row }">{{ scopeText(row) }}</template>
      </el-table-column>
      <el-table-column label="密钥状态" width="200">
        <template #default="{ row }">
          <el-tag size="small" :type="row.privateKeyConfigured ? 'success' : 'warning'">私钥</el-tag>
          <el-tag size="small" :type="row.apiv3SecretConfigured ? 'success' : 'warning'" class="ml">APIv3</el-tag>
          <el-tag size="small" :type="row.platformKeyConfigured ? 'success' : 'warning'" class="ml">平台证书</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusTag(row.status)">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button text type="primary" @click="doValidate(row)">配置检查</el-button>
          <el-button v-if="row.status !== 'active'" text type="success" @click="doActivate(row)">启用</el-button>
          <el-button v-if="row.status === 'active'" text type="warning" @click="doDisable(row)">停用</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="!loading && !error" description="暂无支付账户配置" />
      </template>
    </el-table>

    <!-- 新建 / 编辑 -->
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑支付账户' : '新建支付账户'" width="680px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="150px">
        <el-form-item label="账户名称" prop="name">
          <el-input v-model="form.name" maxlength="50" show-word-limit placeholder="如:学校总部微信支付" />
        </el-form-item>
        <el-form-item label="环境" prop="environment">
          <el-radio-group v-model="form.environment">
            <el-radio value="test">测试</el-radio>
            <el-radio value="production">正式</el-radio>
          </el-radio-group>
          <div class="form-tip">测试密钥不得用于正式环境</div>
        </el-form-item>
        <el-form-item label="适用范围" prop="scopeType">
          <el-radio-group v-model="form.scopeType">
            <el-radio value="all">全校区</el-radio>
            <el-radio value="campuses">指定校区</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.scopeType === 'campuses'" label="指定校区" prop="campusIds">
          <el-select v-model="form.campusIds" multiple placeholder="选择校区" style="width: 100%">
            <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="公众号 AppID" prop="appId">
          <el-input v-model="form.appId" maxlength="64" placeholder="wx 开头,按微信官方格式" />
        </el-form-item>
        <el-form-item label="微信支付商户号" prop="mchId">
          <el-input v-model="form.mchId" maxlength="32" placeholder="按微信官方当前规则" />
        </el-form-item>
        <el-form-item label="商户 API 证书序列号" prop="merchantCertSerial">
          <el-input v-model="form.merchantCertSerial" maxlength="128" placeholder="须与商户证书匹配" />
        </el-form-item>
        <el-form-item label="商户私钥/证书" :prop="editing ? '' : 'keyFile'">
          <el-upload :auto-upload="false" :limit="1" accept=".pem,.p12,.key" :on-change="onKeyFile"
            :on-remove="onKeyFileRemove">
            <el-button type="primary" plain>选择文件</el-button>
            <template #tip>
              <div class="el-upload__tip">
                仅服务端处理,校验 PEM 格式及与证书匹配;{{ editing ? '留空表示不修改' : '首次配置必填' }}。
                已配置: <el-tag size="small" :type="editing?.privateKeyConfigured ? 'success' : 'info'">{{
                  editing?.privateKeyConfigured ? '是' : '否' }}</el-tag>
              </div>
            </template>
          </el-upload>
        </el-form-item>
        <el-form-item label="APIv3 密钥" prop="apiv3Secret">
          <el-input v-model="form.apiv3Secret" type="password" show-password maxlength="64"
            :placeholder="editing ? (editing.apiv3SecretConfigured ? '已配置,留空表示不修改' : '请输入 32 字节密钥') : '请输入 32 字节密钥'" />
        </el-form-item>
        <el-form-item label="平台证书/公钥配置" prop="platformKey">
          <el-input v-model="form.platformKey" type="textarea" :rows="3"
            :placeholder="editing ? (editing.platformKeyConfigured ? '已配置,留空表示不修改' : '填写平台证书或微信支付公钥标识') : '填写平台证书或微信支付公钥标识'" />
          <div class="form-tip">支持轮换;按微信官方要求处理过渡期验签</div>
        </el-form-item>
        <el-form-item label="支付通知 URL" prop="notifyUrl">
          <el-input v-model="form.notifyUrl" maxlength="255" placeholder="https:// 正式域名,不含敏感查询参数" />
        </el-form-item>
        <el-form-item label="退款权限/审批规则" prop="refundPolicy">
          <el-input v-model="form.refundPolicy" type="textarea" :rows="2" maxlength="500"
            placeholder="如:仅财务管理员可执行,超 5000 元需超级管理员审批" />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" maxlength="500" placeholder="禁止存储密钥等敏感信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onSubmit">保存草稿</el-button>
      </template>
    </el-dialog>

    <!-- 配置检查结果 -->
    <el-dialog v-model="checkVisible" title="配置检查结果" width="560px">
      <el-table :data="checks" border>
        <el-table-column prop="name" label="检查项" />
        <el-table-column label="结果" width="100">
          <template #default="{ row }">
            <el-tag :type="row.passed ? 'success' : 'danger'">{{ row.passed ? '通过' : '未通过' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="message" label="说明" />
      </el-table>
      <el-alert type="warning" :closable="false" class="mt">
        配置检查仅校验参数完整性与证书可读性,不能单独证明商户支付权限已开通。
      </el-alert>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
  type UploadFile,
} from 'element-plus'
import { adminApi } from '../api/admin'
import type { Campus, PaymentAccount, PaymentAccountEnv, PaymentAccountStatus } from '../api/types'
import type { NormalizedError } from '../api/client'

const STATUS_TEXT: Record<PaymentAccountStatus, string> = {
  draft: '草稿',
  testing: '待测试',
  active: '已启用',
  disabled: '已停用',
}
const statusText = (s: PaymentAccountStatus) => STATUS_TEXT[s] ?? s
const statusTag = (s: PaymentAccountStatus) =>
  s === 'active' ? 'success' : s === 'disabled' ? 'info' : s === 'testing' ? 'warning' : ''

const items = ref<PaymentAccount[]>([])
const campuses = ref<Campus[]>([])
const loading = ref(false)
const error = ref('')

function scopeText(row: PaymentAccount): string {
  if (row.scopeType === 'all') return '全校区'
  const names = (row.campusIds ?? []).map(
    (id) => campuses.value.find((c) => c.id === id)?.name ?? id,
  )
  return names.length ? names.join('、') : '指定校区'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [res, c] = await Promise.all([
      adminApi.paymentAccounts(),
      adminApi.campuses({ pageSize: 200 }),
    ])
    items.value = Array.isArray(res) ? res : []
    campuses.value = Array.isArray(c) ? c : (c as { items: Campus[] }).items ?? []
  } catch (e) {
    error.value = (e as NormalizedError).message || '加载支付账户失败'
  } finally {
    loading.value = false
  }
}

// ---------- 新建 / 编辑 ----------
const dialogVisible = ref(false)
const editing = ref<PaymentAccount | null>(null)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const keyFile = ref<File | null>(null)

const form = reactive({
  name: '',
  environment: 'test' as PaymentAccountEnv,
  scopeType: 'all' as 'all' | 'campuses',
  campusIds: [] as string[],
  appId: '',
  mchId: '',
  merchantCertSerial: '',
  apiv3Secret: '',
  platformKey: '',
  notifyUrl: '',
  refundPolicy: '',
  remark: '',
})

const rules: FormRules = {
  name: [
    { required: true, message: '请输入账户名称', trigger: 'blur' },
    { min: 2, max: 50, message: '长度为 2-50 个字符', trigger: 'blur' },
  ],
  environment: [{ required: true, message: '请选择环境', trigger: 'change' }],
  scopeType: [{ required: true, message: '请选择适用范围', trigger: 'change' }],
  campusIds: [
    {
      validator: (_r, v: string[], cb) => {
        if (form.scopeType === 'campuses' && (!v || v.length === 0)) cb(new Error('请选择至少一个校区'))
        else cb()
      },
      trigger: 'change',
    },
  ],
  appId: [
    { required: true, message: '请输入公众号 AppID', trigger: 'blur' },
    { pattern: /^wx[0-9a-fA-F]{16}$/, message: 'AppID 格式不正确,应为 wx 开头 18 位', trigger: 'blur' },
  ],
  mchId: [
    { required: true, message: '请输入微信支付商户号', trigger: 'blur' },
    { pattern: /^[0-9]{8,12}$/, message: '商户号格式不正确,请按微信官方当前规则填写', trigger: 'blur' },
  ],
  merchantCertSerial: [{ required: true, message: '请输入商户 API 证书序列号', trigger: 'blur' }],
  keyFile: [
    {
      validator: (_r, _v, cb) => {
        if (!editing.value && !keyFile.value) cb(new Error('首次配置请上传商户私钥/证书文件'))
        else cb()
      },
      trigger: 'change',
    },
  ],
  apiv3Secret: [
    {
      validator: (_r, v: string, cb) => {
        if (!editing.value && !v) return cb(new Error('首次配置请输入 APIv3 密钥'))
        if (v && v.length !== 32) return cb(new Error('APIv3 密钥应为 32 字节'))
        cb()
      },
      trigger: 'blur',
    },
  ],
  platformKey: [{ required: !editing.value, message: '请配置平台证书或公钥', trigger: 'blur' }],
  notifyUrl: [
    { required: true, message: '请输入支付通知 URL', trigger: 'blur' },
    { pattern: /^https:\/\/[^?\s]+$/, message: '须为 HTTPS 地址,且不含敏感查询参数', trigger: 'blur' },
  ],
  refundPolicy: [{ required: true, message: '请填写退款权限/审批规则', trigger: 'blur' }],
}

function onKeyFile(file: UploadFile) {
  keyFile.value = file.raw ?? null
}
function onKeyFileRemove() {
  keyFile.value = null
}

function openCreate() {
  editing.value = null
  keyFile.value = null
  Object.assign(form, {
    name: '',
    environment: 'test' as PaymentAccountEnv,
    scopeType: 'all' as 'all' | 'campuses',
    campusIds: [] as string[],
    appId: '',
    mchId: '',
    merchantCertSerial: '',
    apiv3Secret: '',
    platformKey: '',
    notifyUrl: '',
    refundPolicy: '',
    remark: '',
  })
  dialogVisible.value = true
}

function openEdit(row: PaymentAccount) {
  editing.value = row
  keyFile.value = null
  Object.assign(form, {
    name: row.name,
    environment: row.environment,
    scopeType: row.scopeType,
    campusIds: row.campusIds ?? [],
    appId: row.appId,
    mchId: row.mchId,
    merchantCertSerial: row.merchantCertSerial ?? '',
    apiv3Secret: '',
    platformKey: '',
    notifyUrl: row.notifyUrl,
    refundPolicy: '',
    remark: row.remark ?? '',
  })
  dialogVisible.value = true
}

async function onSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    const base = {
      name: form.name.trim(),
      environment: form.environment,
      scopeType: form.scopeType,
      campusIds: form.scopeType === 'campuses' ? form.campusIds : [],
      appId: form.appId.trim(),
      mchId: form.mchId.trim(),
      merchantCertSerial: form.merchantCertSerial.trim(),
      notifyUrl: form.notifyUrl.trim(),
      refundPolicy: form.refundPolicy.trim(),
      remark: form.remark.trim() || undefined,
    }
    if (editing.value) {
      // 编辑:密钥类字段留空表示不修改;仅当选择了新文件时走 FormData
      if (keyFile.value || form.apiv3Secret || form.platformKey) {
        const fd = new FormData()
        Object.entries(base).forEach(([k, v]) => fd.append(k, JSON.stringify(v)))
        if (keyFile.value) fd.append('privateKeyFile', keyFile.value)
        if (form.apiv3Secret) fd.append('apiv3Secret', form.apiv3Secret)
        if (form.platformKey) fd.append('platformKey', form.platformKey)
        await adminApi.updatePaymentAccount(editing.value.id, fd)
      } else {
        await adminApi.updatePaymentAccount(editing.value.id, base)
      }
      ElMessage.success('支付账户已更新(草稿)')
    } else {
      const fd = new FormData()
      Object.entries(base).forEach(([k, v]) => fd.append(k, JSON.stringify(v)))
      if (keyFile.value) fd.append('privateKeyFile', keyFile.value)
      fd.append('apiv3Secret', form.apiv3Secret)
      fd.append('platformKey', form.platformKey)
      await adminApi.createPaymentAccount(fd)
      ElMessage.success('支付账户草稿已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '保存失败')
  } finally {
    submitting.value = false
  }
}

// ---------- 配置检查 ----------
const checkVisible = ref(false)
const checks = ref<Array<{ name: string; passed: boolean; message?: string }>>([])

async function doValidate(row: PaymentAccount) {
  try {
    const res = await adminApi.validatePaymentAccount(row.id)
    checks.value = res.checks
    checkVisible.value = true
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '配置检查失败')
  }
}

// ---------- 启用 / 停用 ----------
async function doActivate(row: PaymentAccount) {
  const extra =
    row.environment === 'production'
      ? '这是正式环境账户,启用后将真实收款,请二次确认商户号、AppID 绑定与收款主体一致。'
      : '启用后该账户可用于下单与收款。'
  try {
    await ElMessageBox.confirm(`确定启用支付账户「${row.name}」吗?${extra}`, '启用确认', {
      type: 'warning',
      confirmButtonText: '确认启用',
    })
  } catch {
    return
  }
  try {
    await adminApi.activatePaymentAccount(row.id)
    ElMessage.success('已启用')
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '启用失败')
  }
}

async function doDisable(row: PaymentAccount) {
  try {
    await ElMessageBox.confirm(
      `确定停用支付账户「${row.name}」吗?停用后将无法再用该账户创建新的支付订单。`,
      '停用确认',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await adminApi.disablePaymentAccount(row.id)
    ElMessage.success('已停用')
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '停用失败')
  }
}

load()
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
}
.mt {
  margin-top: 16px;
}
.ml {
  margin-left: 4px;
}
.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
</style>
