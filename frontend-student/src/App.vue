<script setup lang="ts">
// 学生端 H5 根组件:移动端居中窄栏布局
</script>

<template>
  <div class="app-shell">
    <router-view />
  </div>
</template>

<style scoped>
.app-shell {
  max-width: 480px;
  margin: 0 auto;
  min-height: 100vh;
  min-height: 100dvh;
  background: #f7f8fa;
}
</style>
