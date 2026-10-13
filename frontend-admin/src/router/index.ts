import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from '../api/client'
import AdminLayout from '../layout/AdminLayout.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/Login.vue'),
      meta: { title: '管理员登录' },
    },
    {
      path: '/403',
      name: 'forbidden',
      component: () => import('../views/Forbidden403.vue'),
      meta: { title: '无权限' },
    },
    {
      path: '/',
      component: AdminLayout,
      children: [
        { path: '', redirect: '/dashboard' },
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('../views/Dashboard.vue'),
          meta: { title: '数据总览', menu: '数据总览' },
        },
        {
          path: 'campuses',
          name: 'campuses',
          component: () => import('../views/Campuses.vue'),
          meta: { title: '校区管理', menu: '校区管理' },
        },
        {
          path: 'fee-periods',
          name: 'fee-periods',
          component: () => import('../views/FeePeriods.vue'),
          meta: { title: '收费期管理', menu: '收费期管理' },
        },
        {
          path: 'students',
          name: 'students',
          component: () => import('../views/Students.vue'),
          meta: { title: '学生管理', menu: '学生管理' },
        },
        {
          path: 'login-codes',
          name: 'login-codes',
          component: () => import('../views/LoginCodes.vue'),
          meta: { title: '登录码管理', menu: '登录码管理' },
        },
        {
          path: 'fee-items',
          name: 'fee-items',
          component: () => import('../views/FeeItems.vue'),
          meta: { title: '课程与收费项目', menu: '课程与收费项目' },
        },
        {
          path: 'invoices',
          name: 'invoices',
          component: () => import('../views/Invoices.vue'),
          meta: { title: '账单管理', menu: '账单管理' },
        },
        {
          path: 'payment-orders',
          name: 'payment-orders',
          component: () => import('../views/PaymentOrders.vue'),
          meta: { title: '支付订单', menu: '支付订单' },
        },
        {
          path: 'refunds',
          name: 'refunds',
          component: () => import('../views/Refunds.vue'),
          meta: { title: '退款管理', menu: '退款管理' },
        },
        {
          path: 'reports',
          name: 'reports',
          component: () => import('../views/Reports.vue'),
          meta: { title: '财务报表', menu: '财务报表' },
        },
        {
          path: 'payment-accounts',
          name: 'payment-accounts',
          component: () => import('../views/PaymentAccounts.vue'),
          meta: { title: '微信支付配置', menu: '微信支付配置' },
        },
        {
          path: 'users',
          name: 'users',
          component: () => import('../views/Users.vue'),
          meta: { title: '管理员与角色', menu: '管理员与角色' },
        },
        {
          path: 'audit-logs',
          name: 'audit-logs',
          component: () => import('../views/AuditLogs.vue'),
          meta: { title: '审计日志', menu: '审计日志' },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFound.vue'),
      meta: { title: '页面不存在' },
    },
  ],
})

// 路由守卫:未登录访问后台页面时跳转 /login
router.beforeEach((to) => {
  const token = getToken()
  const publicPaths = ['/login', '/403']
  if (!token && !publicPaths.includes(to.path)) {
    return '/login'
  }
  if (token && to.path === '/login') {
    return '/dashboard'
  }
})

router.afterEach((to) => {
  const title = (to.meta.title as string) || '培训学校收费系统'
  document.title = `${title} - 管理后台`
})

export default router
