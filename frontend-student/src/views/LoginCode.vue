<script setup lang="ts">
/** 页面 A:登录码验证 —— PRD §6.2 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Button as VanButton, Field as VanField, showToast } from 'vant';
import { studentApi } from '../api/student';
import { maskName } from '../utils/format';
import type { NormalizedError } from '../api/client';
import { useSessionStore } from '../stores/session';

const SCHOOL_NAME = (import.meta.env.VITE_SCHOOL_NAME as string | undefined) || '培训学校';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const code = ref('');
const submitting = ref(false);
const failedCount = ref(0);

const canSubmit = computed(() => code.value.trim().length > 0 && !submitting.value);

onMounted(() => {
  if (route.query.expired === '1') {
    showToast('登录已过期,请重新验证');
  }
});

/** 统一的失败提示:不透露登录码/学生是否存在(PRD §6.2) */
function friendlyLoginError(err: unknown): string {
  const e = err as NormalizedError;
  if (e?.status === 429) return '尝试过于频繁,请稍后再试';
  if (e?.status === 400 || e?.status === 404) return '登录码无效或已过期,请检查后重试';
  return e?.message || '验证失败,请稍后重试';
}

async function handleSubmit() {
  const trimmed = code.value.trim();
  if (!trimmed || submitting.value) return;
  submitting.value = true;
  try {
    const res = await studentApi.exchangeCode(trimmed);
    session.exchangeToken = res.exchangeToken;
    session.pendingStudent = res.student;
    if (res.needConfirm === false) {
      // 后端直接完成绑定
      session.setBound(res.student);
      showToast('验证成功');
      await router.replace('/');
      return;
    }
    // 二次确认:展示脱敏后的学生信息,防止拿错别人的码
    const confirmed = await confirmBind(res.student.name);
    if (!confirmed) return;
    const bound = await studentApi.bind(res.exchangeToken);
    session.setBound(bound.student);
    showToast('绑定成功');
    const redirect = route.query.redirect as string | undefined;
    await router.replace(redirect || '/');
  } catch (err) {
    failedCount.value += 1;
    // 登录码不回显到错误里;失败后清空输入,防暴力尝试
    code.value = '';
    showToast(friendlyLoginError(err));
  } finally {
    submitting.value = false;
  }
}

async function confirmBind(name: string): Promise<boolean> {
  try {
    await showConfirmDialog(`请确认绑定学生「${maskName(name)}」吗?`);
    return true;
  } catch {
    return false;
  }
}

// 轻量确认框(避免引入 Dialog 组件的样式依赖)
function showConfirmDialog(message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = window.confirm(message);
    if (ok) resolve();
    else reject(new Error('cancelled'));
  });
}
</script>

<template>
  <div class="page">
    <div class="brand-header">
      <h1>{{ SCHOOL_NAME }}</h1>
      <p>学费缴纳 · 安全便捷</p>
    </div>

    <div class="card">
      <h2 class="card-title">请输入登录码</h2>
      <p class="muted">登录码由学校发放,每个码仅可使用一次</p>
      <VanField
        v-model="code"
        label="登录码"
        placeholder="请输入或粘贴学校发放的登录码"
        clearable
        autocomplete="off"
        autocapitalize="off"
        :spellcheck="false"
        @keyup.enter="handleSubmit"
      />
      <div class="btn-wrap">
        <VanButton
          type="primary"
          block
          :loading="submitting"
          :disabled="!canSubmit"
          loading-text="验证中…"
          @click="handleSubmit"
        >
          验证并绑定
        </VanButton>
      </div>
      <p v-if="failedCount > 0" class="muted warn">
        已失败 {{ failedCount }} 次,请确认登录码无误;多次失败将暂时锁定
      </p>
    </div>

    <p class="privacy-tip">
      隐私提示:本页面仅用于核验缴费身份。学校不会在此收集身份证号等敏感信息;
      您的登录状态仅保存在本次会话中,退出后需重新验证。
    </p>
  </div>
</template>

<style scoped>
.card-title {
  margin: 0 0 4px;
  font-size: 17px;
}
.btn-wrap {
  margin-top: 16px;
}
.warn {
  margin-top: 12px;
  color: #ee0a24;
}
</style>
