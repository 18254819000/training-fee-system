<template>
  <el-container class="admin-layout">
    <el-aside width="220px" class="sidebar">
      <div class="brand">
        <span class="brand-name">收费系统</span>
        <span class="brand-sub">管理后台</span>
      </div>
      <el-menu :default-active="$route.path" router class="side-menu" background-color="#304156" text-color="#bfcbd9"
        active-text-color="#409eff">
        <el-menu-item index="/dashboard">数据总览</el-menu-item>
        <el-menu-item index="/campuses">校区管理</el-menu-item>
        <el-menu-item index="/fee-periods">收费期管理</el-menu-item>
        <el-menu-item index="/students">学生管理</el-menu-item>
        <!-- 登录码已下线（改手机号登录） -->
        <el-menu-item index="/fee-items">课程与收费项目</el-menu-item>
        <el-menu-item index="/invoices">账单管理</el-menu-item>
        <el-menu-item index="/payment-orders">支付订单</el-menu-item>
        <el-menu-item index="/refunds">退款管理</el-menu-item>
        <el-menu-item index="/reports">财务报表</el-menu-item>
        <el-menu-item index="/payment-accounts">微信支付配置</el-menu-item>
        <el-menu-item index="/users">管理员与角色</el-menu-item>
        <el-menu-item index="/audit-logs">审计日志</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="topbar">
        <div class="page-title">{{ $route.meta.title }}</div>
        <div class="user-area">
          <span class="username">{{ auth.user?.username ?? '管理员' }}</span>
          <el-button text size="small" :loading="loggingOut" @click="onLogout">退出登录</el-button>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const loggingOut = ref(false)

async function onLogout() {
  loggingOut.value = true
  try {
    await auth.logout()
    ElMessage.success('已退出登录')
    router.replace('/login')
  } finally {
    loggingOut.value = false
  }
}
</script>

<style scoped>
.admin-layout {
  height: 100vh;
}

.sidebar {
  background: #304156;
  display: flex;
  flex-direction: column;
}

.brand {
  height: 60px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 20px;
  color: #fff;
  border-bottom: 1px solid #2b3a4d;
}

.brand-name {
  font-size: 18px;
  font-weight: 600;
  line-height: 60px;
}

.brand-sub {
  font-size: 12px;
  color: #8fa3b8;
}

.side-menu {
  border-right: none;
  flex: 1;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #e6e8eb;
  height: 60px;
}

.page-title {
  font-size: 16px;
  font-weight: 600;
}

.user-area {
  display: flex;
  align-items: center;
  gap: 12px;
}

.username {
  color: #606266;
}

.main {
  background: #f5f7fa;
  padding: 20px;
}
</style>
