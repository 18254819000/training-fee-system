import { defineStore } from 'pinia'
import { adminApi } from '../api/admin'
import { getToken, setToken } from '../api/client'
import type { AdminUser } from '../api/types'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: getToken(),
    user: null as AdminUser | null,
  }),
  getters: {
    isLoggedIn: (state) => !!state.token,
    roles: (state): string[] => state.user?.roles ?? [],
  },
  actions: {
    async login(username: string, password: string) {
      const res = await adminApi.login(username, password)
      setToken(res.token)
      this.token = res.token
      this.user = res.user
    },
    async logout() {
      try {
        await adminApi.logout()
      } catch {
        // 即使后端登出失败,也清掉本地会话
      }
      setToken(null)
      this.token = null
      this.user = null
    },
  },
})
