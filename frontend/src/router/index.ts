import { createRouter, createWebHistory } from 'vue-router'

import Overview from '@/views/Overview.vue'
const Ods = () => import('@/views/ods/index.vue')
const Dwd = () => import('@/views/dwd/index.vue')
const Dws = () => import('@/views/dws/index.vue')
const Ads = () => import('@/views/ads/index.vue')
const Source = () => import('@/views/source/index.vue')
const Partition = () => import('@/views/partition/index.vue')
const Cleanse = () => import('@/views/cleanse/index.vue')
const Transform = () => import('@/views/transform/index.vue')
const TransformDetail = () => import('@/views/transform/detail.vue')
const Quality = () => import('@/views/quality/index.vue')
const Lineage = () => import('@/views/lineage/index.vue')
const Backfill = () => import('@/views/backfill/index.vue')
const Schema = () => import('@/views/schema/index.vue')
const Datasync = () => import('@/views/datasync/index.vue')
const Snapshot = () => import('@/views/snapshot/index.vue')
const Govern = () => import('@/views/govern/index.vue')
const Monitor = () => import('@/views/monitor/index.vue')
const Audit = () => import('@/views/audit/index.vue')
const Catalog = () => import('@/views/catalog/index.vue')
const GenericDetail = () => import('@/views/generic/Detail.vue')

// 除转换编排（有专属波次回看页）外，其余模块共用一个详情页。
const GENERIC_MODULES = [
  'ods', 'dwd', 'dws', 'ads', 'source', 'partition', 'cleanse', 'quality',
  'lineage', 'backfill', 'schema', 'datasync', 'snapshot', 'govern', 'monitor', 'audit', 'catalog',
]

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'overview', component: Overview },
    { path: '/ods', name: 'ods', component: Ods },
    { path: '/dwd', name: 'dwd', component: Dwd },
    { path: '/dws', name: 'dws', component: Dws },
    { path: '/ads', name: 'ads', component: Ads },
    { path: '/source', name: 'source', component: Source },
    { path: '/partition', name: 'partition', component: Partition },
    { path: '/cleanse', name: 'cleanse', component: Cleanse },
    { path: '/transform', name: 'transform', component: Transform },
    { path: '/transform/:id', name: 'transform-detail', component: TransformDetail },
    { path: '/quality', name: 'quality', component: Quality },
    { path: '/lineage', name: 'lineage', component: Lineage },
    { path: '/backfill', name: 'backfill', component: Backfill },
    { path: '/schema', name: 'schema', component: Schema },
    { path: '/datasync', name: 'datasync', component: Datasync },
    { path: '/snapshot', name: 'snapshot', component: Snapshot },
    { path: '/govern', name: 'govern', component: Govern },
    { path: '/monitor', name: 'monitor', component: Monitor },
    { path: '/audit', name: 'audit', component: Audit },
    { path: '/catalog', name: 'catalog', component: Catalog },
    ...GENERIC_MODULES.map((key) => ({
      path: `/${key}/:id`,
      name: `${key}-detail`,
      component: GenericDetail,
      props: false,
    })),
  ],
})

export default router
