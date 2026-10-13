import { createRouter, createWebHistory } from 'vue-router';
import { useSessionStore } from '../stores/session';

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginCode.vue'), meta: { public: true } },
  { path: '/', name: 'home', component: () => import('../views/Home.vue') },
  { path: '/invoices/:id', name: 'invoice-detail', component: () => import('../views/InvoiceDetail.vue') },
  { path: '/pay/:invoiceId', name: 'confirm-pay', component: () => import('../views/ConfirmPay.vue') },
  { path: '/pay/result/:orderId', name: 'pay-result', component: () => import('../views/PayResult.vue') },
  { path: '/history', name: 'history', component: () => import('../views/History.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  const session = useSessionStore();
  if (session.authed) return true;
  // 刷新后靠后端 Cookie 恢复会话
  const ok = await session.restore();
  if (ok) return true;
  return { path: '/login', query: { redirect: to.fullPath } };
});

export default router;
