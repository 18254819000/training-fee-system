import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Vant from 'vant';
import 'vant/lib/index.css';
import './style.css';
import App from './App.vue';
import router from './router';
import { setOnUnauthorized } from './api/client';
import { useSessionStore } from './stores/session';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);
app.use(Vant);

// 401 全局处理:清本地会话状态并回登录页(学生端会话走 Cookie,此处仅清本地状态)
setOnUnauthorized(() => {
  const session = useSessionStore();
  session.clearLocal();
  if (router.currentRoute.value.path !== '/login') {
    router.replace({ path: '/login', query: { expired: '1' } });
  }
});

app.mount('#app');
