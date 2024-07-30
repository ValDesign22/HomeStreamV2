import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('@/views/HomeView.vue')
    }, {
      path: '/register',
      component: () => import('@/views/RegisterView.vue')
    }
  ]
});

export default router;
