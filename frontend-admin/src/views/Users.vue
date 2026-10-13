<template>
  <div class="page-card">
    <el-tabs v-model="activeTab">
      <!-- 管理员 -->
      <el-tab-pane label="管理员账号" name="users">
        <div class="toolbar">
          <div class="spacer" />
          <el-button type="primary" @click="openCreateUser">新增管理员</el-button>
        </div>
        <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" class="mb" />
        <el-table v-loading="loading" :data="users" border>
          <el-table-column prop="username" label="账号" width="160" />
          <el-table-column label="角色" min-width="180">
            <template #default="{ row }">
              <el-tag v-for="r in row.roles" :key="r" size="small" class="ml">{{ roleName(r) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="校区范围" min-width="160">
            <template #default="{ row }">{{ campusScopeText(row) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'info'">
                {{ row.status === 'active' ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="最近登录" width="170">
            <template #default="{ row }">{{ formatDateTime(row.lastLoginAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <el-button text type="primary" @click="openEditUser(row)">编辑</el-button>
              <el-button text type="primary" @click="openResetPwd(row)">重置密码</el-button>
              <el-button v-if="row.status === 'active'" text type="warning" @click="toggleUser(row, 'disabled')">停用</el-button>
              <el-button v-else text type="success" @click="toggleUser(row, 'active')">启用</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty v-if="!loading && !error" description="暂无管理员" />
          </template>
        </el-table>
        <div class="pagination-bar">
          <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total"
            :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadUsers" />
        </div>
      </el-tab-pane>

      <!-- 角色 -->
      <el-tab-pane label="角色管理" name="roles">
        <div class="toolbar">
          <div class="spacer" />
          <el-button type="primary" @click="roleDialogVisible = true">新增角色</el-button>
        </div>
        <el-table v-loading="rolesLoading" :data="roles" border>
          <el-table-column prop="code" label="角色编码" width="180" />
          <el-table-column prop="name" label="角色名称" width="180" />
          <el-table-column label="权限">
            <template #default="{ row }">
              <el-tag v-for="p in row.permissions" :key="p" size="small" type="info" class="ml">{{ p }}</el-tag>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty v-if="!rolesLoading" description="暂无角色" />
          </template>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 新增/编辑管理员 -->
    <el-dialog v-model="dialogVisible" :title="editingUser ? '编辑管理员' : '新增管理员'" width="560px">
      <el-form ref="formRef" :model="userForm" :rules="userRules" label-width="96px">
        <el-form-item label="账号" prop="username">
          <el-input v-model="userForm.username" maxlength="64" :disabled="!!editingUser" placeholder="登录账号,创建后不可改" />
        </el-form-item>
        <el-form-item v-if="!editingUser" label="初始密码" prop="password">
          <el-input v-model="userForm.password" type="password" show-password maxlength="64" placeholder="请设置强密码" />
        </el-form-item>
        <el-form-item label="角色" prop="roles">
          <el-select ref="userRoleSelect" v-model="userForm.roles" multiple placeholder="选择角色" style="width: 100%" @change="userRoleSelect?.blur()">
            <el-option v-for="r in roles" :key="r.code" :label="r.name" :value="r.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="校区范围" prop="campusIds">
          <el-select ref="userCampusSelect" v-model="userForm.campusIds" multiple placeholder="校区管理员限定;总部角色可留空" style="width: 100%" @change="userCampusSelect?.blur()">
            <el-option v-for="c in campuses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <div class="form-tip">校区管理员只能管理所选校区的数据;总部/财务角色留空表示全部校区</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onSubmitUser">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码 -->
    <el-dialog v-model="pwdVisible" title="重置密码" width="440px">
      <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" label-width="96px">
        <el-form-item label="新密码" prop="password">
          <el-input v-model="pwdForm.password" type="password" show-password maxlength="64" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdSubmitting" @click="onResetPwd">确认重置</el-button>
      </template>
    </el-dialog>

    <!-- 新增角色 -->
    <el-dialog v-model="roleDialogVisible" title="新增角色" width="560px">
      <el-form ref="roleFormRef" :model="roleForm" :rules="roleRules" label-width="96px">
        <el-form-item label="角色编码" prop="code">
          <el-input v-model="roleForm.code" maxlength="64" placeholder="如 campus_admin" />
        </el-form-item>
        <el-form-item label="角色名称" prop="name">
          <el-input v-model="roleForm.name" maxlength="64" placeholder="如 校区管理员" />
        </el-form-item>
        <el-form-item label="权限" prop="permissions">
          <el-checkbox-group v-model="roleForm.permissions">
            <el-checkbox v-for="p in ALL_PERMISSIONS" :key="p.value" :value="p.value">{{ p.label }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="roleSubmitting" @click="onSubmitRole">保存</el-button>
      </template>
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
} from 'element-plus'
import { adminApi, toArray } from '../api/admin'
import { formatDateTime } from '../utils/format'
import type { AdminUser, Campus, Role } from '../api/types'
import type { NormalizedError } from '../api/client'
const userRoleSelect = ref()
const userCampusSelect = ref()

const ALL_PERMISSIONS = [
  { value: 'campus:manage', label: '校区管理' },
  { value: 'fee-period:manage', label: '收费期管理' },
  { value: 'student:manage', label: '学生管理' },
  { value: 'student:import', label: '学生导入' },
  { value: 'login-code:manage', label: '登录码管理' },
  { value: 'fee-item:manage', label: '课程与价格管理' },
  { value: 'invoice:generate', label: '账单生成' },
  { value: 'invoice:void', label: '账单作废' },
  { value: 'order:view', label: '订单查看' },
  { value: 'order:reconcile', label: '订单查单' },
  { value: 'refund:apply', label: '退款申请' },
  { value: 'refund:approve', label: '退款审批' },
  { value: 'report:view', label: '报表查看' },
  { value: 'report:export', label: '数据导出' },
  { value: 'payment:config', label: '支付账户配置' },
  { value: 'user:manage', label: '管理员管理' },
  { value: 'audit:view', label: '审计日志查看' },
]

const activeTab = ref('users')
const users = ref<AdminUser[]>([])
const roles = ref<Role[]>([])
const campuses = ref<Campus[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const rolesLoading = ref(false)
const error = ref('')

function roleName(code: string): string {
  return roles.value.find((r) => r.code === code)?.name ?? code
}
function campusScopeText(row: AdminUser): string {
  if (!row.campusIds || row.campusIds.length === 0) return '全部校区'
  return row.campusIds
    .map((id) => campuses.value.find((c) => c.id === id)?.name ?? id)
    .join('、')
}

async function loadUsers() {
  loading.value = true
  error.value = ''
  try {
    const [res, r, c] = await Promise.all([
      adminApi.adminUsers({ page: page.value, pageSize: pageSize.value }),
      adminApi.roles(),
      adminApi.campuses({ pageSize: 200 }),
    ])
    const arr = toArray(res)
    users.value = arr
    total.value = Array.isArray(res) ? res.length : (res as { total: number }).total
    roles.value = Array.isArray(r) ? r : []
    campuses.value = toArray(c)
  } catch (e) {
    error.value = (e as NormalizedError).message || '加载管理员列表失败'
  } finally {
    loading.value = false
  }
}

async function loadRoles() {
  rolesLoading.value = true
  try {
    const r = await adminApi.roles()
    roles.value = Array.isArray(r) ? r : []
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '加载角色失败')
  } finally {
    rolesLoading.value = false
  }
}

// ---------- 新增 / 编辑管理员 ----------
const dialogVisible = ref(false)
const editingUser = ref<AdminUser | null>(null)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const userForm = reactive({
  username: '',
  password: '',
  roles: [] as string[],
  campusIds: [] as string[],
})
const userRules: FormRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [
    { required: true, message: '请设置初始密码', trigger: 'blur' },
    { min: 8, message: '密码至少 8 位', trigger: 'blur' },
  ],
  roles: [{ required: true, message: '请选择至少一个角色', trigger: 'change' }],
}

function openCreateUser() {
  editingUser.value = null
  Object.assign(userForm, { username: '', password: '', roles: [], campusIds: [] })
  dialogVisible.value = true
}
function openEditUser(row: AdminUser) {
  editingUser.value = row
  Object.assign(userForm, {
    username: row.username,
    password: '',
    roles: [...row.roles],
    campusIds: [...row.campusIds],
  })
  dialogVisible.value = true
}

async function onSubmitUser() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingUser.value) {
      await adminApi.updateAdminUser(editingUser.value.id, {
        roles: userForm.roles,
        campusIds: userForm.campusIds,
      })
      ElMessage.success('管理员已更新')
    } else {
      await adminApi.createAdminUser({
        username: userForm.username.trim(),
        password: userForm.password,
        roles: userForm.roles,
        campusIds: userForm.campusIds,
      })
      ElMessage.success('管理员已创建')
    }
    dialogVisible.value = false
    await loadUsers()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '保存失败')
  } finally {
    submitting.value = false
  }
}

async function toggleUser(row: AdminUser, status: 'active' | 'disabled') {
  const action = status === 'active' ? '启用' : '停用'
  try {
    await ElMessageBox.confirm(`确定${action}管理员「${row.username}」吗?`, '确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await adminApi.updateAdminUser(row.id, { status })
    ElMessage.success(`已${action}`)
    await loadUsers()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '操作失败')
  }
}

// ---------- 重置密码 ----------
const pwdVisible = ref(false)
const pwdSubmitting = ref(false)
const pwdFormRef = ref<FormInstance>()
const pwdTarget = ref<AdminUser | null>(null)
const pwdForm = reactive({ password: '' })
const pwdRules: FormRules = {
  password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码至少 8 位', trigger: 'blur' },
  ],
}
function openResetPwd(row: AdminUser) {
  pwdTarget.value = row
  pwdForm.password = ''
  pwdVisible.value = true
}
async function onResetPwd() {
  const valid = await pwdFormRef.value?.validate().catch(() => false)
  if (!valid || !pwdTarget.value) return
  pwdSubmitting.value = true
  try {
    await adminApi.updateAdminUser(pwdTarget.value.id, { password: pwdForm.password })
    ElMessage.success('密码已重置')
    pwdVisible.value = false
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '重置失败')
  } finally {
    pwdSubmitting.value = false
  }
}

// ---------- 新增角色 ----------
const roleDialogVisible = ref(false)
const roleSubmitting = ref(false)
const roleFormRef = ref<FormInstance>()
const roleForm = reactive({ code: '', name: '', permissions: [] as string[] })
const roleRules: FormRules = {
  code: [{ required: true, message: '请输入角色编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
  permissions: [{ required: true, message: '请选择至少一项权限', trigger: 'change' }],
}
async function onSubmitRole() {
  const valid = await roleFormRef.value?.validate().catch(() => false)
  if (!valid) return
  roleSubmitting.value = true
  try {
    await adminApi.createRole({
      code: roleForm.code.trim(),
      name: roleForm.name.trim(),
      permissions: roleForm.permissions,
    })
    ElMessage.success('角色已创建')
    roleDialogVisible.value = false
    Object.assign(roleForm, { code: '', name: '', permissions: [] })
    await loadRoles()
  } catch (e) {
    ElMessage.error((e as NormalizedError).message || '保存失败')
  } finally {
    roleSubmitting.value = false
  }
}

loadUsers()
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
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
