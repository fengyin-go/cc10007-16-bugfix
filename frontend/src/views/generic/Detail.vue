<template>
  <section class="page" data-module="generic-detail">
    <header class="page-head">
      <div>
        <h2>{{ meta.entity }}详情</h2>
        <p class="page-desc">详情始终从主存储按编号实时读取，列表页的筛选与缓存不影响这里的值，避免列表与详情对不上。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" :to="`/${meta.key}`">返回{{ meta.name }}列表</RouterLink>
      </div>
    </header>

    <div v-if="!row" class="empty-state">没有找到该{{ meta.entity }}，可能已被删除。</div>
    <article v-else class="detail-card">
      <dl class="detail-grid">
        <div>
          <dt>记录编号</dt>
          <dd>{{ row.id }}</dd>
        </div>
        <div>
          <dt>当前状态</dt>
          <dd><span class="badge">{{ row.status }}</span></dd>
        </div>
        <div>
          <dt>待处理</dt>
          <dd>{{ row.pending ? '是' : '否' }}</dd>
        </div>
        <div>
          <dt>异常标记</dt>
          <dd :class="row.abnormal ? 'danger' : 'ok'">{{ row.abnormal ? '异常' : '正常' }}</dd>
        </div>
        <div v-for="field in meta.fields" :key="field">
          <dt>{{ field }}</dt>
          <dd>{{ row[field] ?? '—' }}</dd>
        </div>
      </dl>

      <h3>生命周期操作（按当前阶段「{{ row.status }}」放行）</h3>
      <div class="action-bar">
        <button
          v-for="action in allowedActions"
          :key="action"
          class="btn"
          type="button"
          @click="onAction(action)"
        >
          {{ action }}
        </button>
      </div>
      <p v-if="message" :class="resultOk ? 'ok-text' : 'error-text'">{{ message }}</p>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getEntry, moduleMeta, runAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const moduleKey = String(route.path.split('/')[1] ?? '')
const meta = moduleMeta(moduleKey)

const row = ref<EntryRow | undefined>()
const message = ref('')
const resultOk = ref(true)

const allowedActions = computed(() => {
  if (!row.value) return []
  const current = String(row.value.status)
  return meta.actions.filter((action) => {
    const allowed = meta.transitions?.[action]
    return !allowed || allowed.includes(current)
  })
})

function load() {
  message.value = ''
  row.value = getEntry(meta.key, Number(route.params.id))
}

function onAction(action: string) {
  if (!row.value) return
  const result = runAction(meta.key, Number(row.value.id), action)
  resultOk.value = result.ok
  message.value = result.message
  if (result.ok) {
    load()
  }
}

onMounted(load)
watch(() => route.params.id, load)
</script>

<style scoped>
.detail-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 16px 18px; }
.detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 18px; margin: 0 0 16px; }
.detail-grid dt { color: var(--muted); font-size: 12px; }
.detail-grid dd { margin: 2px 0 0; font-size: 13px; }
.badge { display: inline-block; border-radius: 999px; padding: 2px 10px; font-size: 12px; background: #eef2f7; }
.action-bar { display: flex; flex-wrap: wrap; gap: 8px; }
.ok-text { color: #067647; }
.error-text { color: #b42318; }
.danger { color: #b42318; }
.ok { color: #067647; }
.empty-state { text-align: center; color: var(--muted); padding: 40px 0; }
h3 { font-size: 14px; margin: 8px 0; }
</style>
