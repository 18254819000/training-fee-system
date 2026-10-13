import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'
import router from './router'
import { setOnUnauthorized, setToken } from './api/client'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 401 全局处理:清 token 并跳转登录页
setOnUnauthorized(() => {
  setToken(null)
  router.replace('/login')
})

app.mount('#app')
