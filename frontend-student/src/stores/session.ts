/** 学生端会话状态 —— 会话本身由后端 Cookie 维持,此处仅缓存可展示信息 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { studentApi } from '../api/student';
import type { MeStudent } from '../api/types';

export const useSessionStore = defineStore('session', () => {
  const student = ref<MeStudent | null>(null);
  /** 已确认会话有效(后端 Cookie 仍有效) */
  const authed = ref(false);
  /** 登录码兑换第一步返回的临时凭证(内存中,不进 URL,也不持久化) */
  const exchangeToken = ref<string | null>(null);
  const pendingStudent = ref<MeStudent | null>(null);

  /** 用 /me/students 校验会话是否有效(刷新页面后恢复) */
  async function restore(): Promise<boolean> {
    try {
      const list = await studentApi.meStudents();
      if (list && list.length > 0) {
        student.value = list[0];
        authed.value = true;
        return true;
      }
      return false;
    } catch {
      authed.value = false;
      student.value = null;
      return false;
    }
  }

  function setBound(s: MeStudent) {
    student.value = s;
    authed.value = true;
    exchangeToken.value = null;
    pendingStudent.value = null;
  }

  /** 仅清本地状态(401 时调用);服务端会话由后端过期策略控制 */
  function clearLocal() {
    student.value = null;
    authed.value = false;
    exchangeToken.value = null;
    pendingStudent.value = null;
  }

  async function logout() {
    try {
      await studentApi.logout();
    } catch {
      /* 忽略登出接口错误,本地照样清理 */
    }
    clearLocal();
  }

  return {
    student,
    authed,
    exchangeToken,
    pendingStudent,
    restore,
    setBound,
    clearLocal,
    logout,
  };
});
