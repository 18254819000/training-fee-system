<template>
  <div class="login-wrap">
    <el-card class="login-card" shadow="hover">
      <h2 class="login-title">收费系统 · 管理后台</h2>
      <p class="login-sub">请使用管理员账号登录</p>
      <el-alert v-if="attempts >= 3" type="warning" :closable="false" class="login-alert">
        已连续失败 {{ attempts }} 次,请确认账号密码无误;多次失败账号可能被暂时锁定。
      </el-alert>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="72px" @keyup.enter="onSubmit">
        <el-form-item label="账号" prop="username">
          <el-input v-model="form.username" placeholder="请输入管理员账号" autocomplete="username" clearable />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" autocomplete="current-password"
            show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" class="submit-btn" @click="onSubmit">
            {{ loading ? '登录中…' : '登 录' }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import type { NormalizedError } from '../api/client'

const router = useRouter()
const auth = useAuthStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const attempts = ref(0)

const form = reactive({ username: '', password: '' })
const rules: FormRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function onSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await auth.login(form.username.trim(), form.password)
    ElMessage.success('登录成功')
    router.replace('/dashboard')
  } catch (err) {
    attempts.value += 1
    const e = err as NormalizedError
    if (e.status === 401 || e.status === 400) {
      ElMessage.error(`账号或密码错误(第 ${attempts.value} 次),请检查后重试`)
    } else {
      ElMessage.error(e.message)
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #304156 0%, #1f2d3d 100%);
}

.login-card {
  width: 400px;
  padding: 8px;
}

.login-title {
  margin: 8px 0 4px;
  font-size: 20px;
  text-align: center;
}

.login-sub {
  margin: 0 0 20px;
  color: #909399;
  font-size: 13px;
  text-align: center;
}

.login-alert {
  margin-bottom: 16px;
}

.submit-btn {
  width: 100%;
}
</style>
