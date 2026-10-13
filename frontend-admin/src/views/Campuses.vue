<template>
  <div class="page-card">
    <div class="toolbar">
      <el-input v-model="filters.keyword" placeholder="按名称/编码搜索" clearable style="width: 240px" @change="load" />
      <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 140px" @change="load">
        <el-option label="启用" value="active" />
        <el-option label="停用" value="inactive" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <div class="spacer" />
      <el-button type="primary" @click="openCreate">新建校区</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />

    <el-table v-loading="loading" :data="items" border>
      <el-table-column prop="code" label="校区编码" width="140" />
      <el-table-column prop="name" label="校区名称" />
      <el-table-column prop="address" label="地址" show-overflow-tooltip />
      <el-table-column prop="contactName" label="联系人" width="110" />
      <el-table-column prop="contactPhone" label="联系电话" width="140" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'">
            {{ statusText(CAMPUS_STATUS_TEXT, row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="更新时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status === 'active'" text type="warning" @click="toggleStatus(row, 'inactive')">停用</el-button>
          <el-button v-else text type="success" @click="toggleStatus(row, 'active')">启用</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="!loading && !error" description="暂无校区数据" />
      </template>
    </el-table>

    <div class="pagination-bar">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total"
        :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑校区' : '新建校区'" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="校区名称" prop="name">
          <el-input v-model="form.name" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="校区编码" prop="code">
          <el-input v-model="form.code" maxlength="32" placeholder="唯一编码,如 BJ01" :disabled="!!editing" />
        </el-form-item>
        <el-form-item label="地址" prop="address">
          <el-input v-model="form.address" maxlength="255" />
        </el-form-item>
        <el-form-item label="联系人" prop="contactName">
          <el-input v-model="form.contactName" maxlength="80" />
        </el-form-item>
        <el-form-item label="联系电话" prop="contactPhone">
          <el-input v-model="form.contactPhone" maxlength="32" placeholder="最小化收集" />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" />
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
import { CAMPUS_STATUS_TEXT, formatDateTime, statusText } from '../utils/format'
import type { Campus } from '../api/types'
import type { NormalizedError } from '../api/client'

const items = ref<Campus[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const error = ref('')
const filters = reactive({ keyword: '', status: '' })

const dialogVisible = ref(false)
const editing = ref<Campus | null>(null)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({
  name: '',
  code: '',
  address: '',
  contactName: '',
  contactPhone: '',
  remark: '',
})

const rules: FormRules = {
  name: [
    { required: true, message: '请输入校区名称', trigger: 'blur' },
    { min: 2, max: 100, message: '名称长度 2–100 个字符', trigger: 'blur' },
  ],
  code: [
    { required: true, message: '请输入校区编码', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9_-]{2,32}$/, message: '编码为 2–32 位字母/数字/下划线/短横线', trigger: 'blur' },
  ],
  contactPhone: [
    { pattern: /^[0-9+\-\s]{0,32}$/, message: '联系电话格式不正确', trigger: 'blur' },
  ],
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await adminApi.campuses({
      page: page.value,
      pageSize: pageSize.value,
      keyword: filters.keyword || undefined,
      status: filters.status || undefined,
    })
    items.value = toArray(res)
    total.value = toPage(res, page.value, pageSize.value).total
  } catch (e) {
    error.value = (e as NormalizedError).message || '加载校区列表失败'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', code: '', address: '', contactName: '', contactPhone: '', remark: '' })
  dialogVisible.value = true
}

function openEdit(row: Campus) {
  editing.value = row
  Object.assign(form, {
    name: row.name,
    code: row.code,
    address: row.address ?? '',
    contactName: row.contactName ?? '',
    contactPhone: row.contactPhone ?? '',
    remark: '',
  })
  dialogVisible.value = true
}

async function onSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  // 客户端编码唯一性预校验(服务端 409 为最终防线)
  if (!editing.value && items.value.some((c) => c.code === form.code.trim())) {
    ElMessage.error('校区编码已存在,请更换编码')
    return
  }
  submitting.value = true
  try {
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      address: form.address.trim() || undefined,
      contactName: form.contactName.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
    }
    if (editing.value) {
      await adminApi.updateCampus(editing.value.id, payload)
      ElMessage.success('校区已更新')
    } else {
      await adminApi.createCampus(payload)
      ElMessage.success('校区已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '保存失败')
  } finally {
    submitting.value = false
  }
}

// PRD §4.2:有历史账单的校区只停用不删除
async function toggleStatus(row: Campus, status: 'active' | 'inactive') {
  const action = status === 'active' ? '启用' : '停用'
  try {
    await ElMessageBox.confirm(
      status === 'inactive'
        ? `确定停用校区「${row.name}」吗?停用后该校区不再用于新业务,历史数据保留。`
        : `确定启用校区「${row.name}」吗?`,
      '确认',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await adminApi.updateCampus(row.id, { status })
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
</style>
