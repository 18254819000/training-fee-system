<template>
  <div class="status-page">
    <el-result icon="warning" title="403" sub-title="您没有权限访问该页面或执行该操作">
      <template #extra>
        <el-button type="primary" @click="$router.replace('/dashboard')">返回首页</el-button>
      </template>
    </el-result>
  </div>
</template>

<style scoped>
.status-page {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: 8px;
}
</style>
