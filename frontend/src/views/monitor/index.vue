<template>
  <section class="page" data-module="monitor">
    <header class="page-head">
      <div>
        <h2>任务监控管理</h2>
        <p class="page-desc">
          关联转换节点的封印链健康度：上游冻结会留下断签，监控如实汇总为异常态，不再按绿态掩盖断签。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出任务监控清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">监控配置总数</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">关联节点断签总数</span>
        <strong class="stat-value" :class="{ danger: totalBroken > 0 }">{{ totalBroken }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">断签告警配置</span>
        <strong class="stat-value" :class="{ danger: alarmedConfigs > 0 }">{{ alarmedConfigs }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">健康配置</span>
        <strong class="stat-value ok">{{ healthyConfigs }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div v-if="totalBroken > 0" class="alert-banner">
      检测到 {{ totalBroken }} 处断签：相关转换计划已停在断签位置，需上游重签后续跑，监控不再按绿态汇总。
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>关联节点断签</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-alarm': brokenOf(row) > 0 }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span v-if="brokenOf(row) > 0" class="badge danger">断签 {{ brokenOf(row) }} 处 · 告警中</span>
            <span v-else class="badge ok">签章齐备</span>
          </td>
          <td>
            {{ row.status }}
            <div v-if="brokenOf(row) > 0" class="cell-sub danger">实际健康度：异常（与配置状态分离统计）</div>
          </td>
          <td class="row-actions">
            <button
              v-for="action in allowedActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无任务监控数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条任务监控记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { brokenSealByNode } from '@/data/orchestration'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('monitor')
const columns = ['配置编号', '关联任务', '监控指标', '告警阈值', '告警级别', '静默分钟', '通知渠道', '恢复条件']
const statuses = ['草稿', '待校验', '已启用', '已停用']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const brokenMap = ref<Record<string, number>>({})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const totalBroken = computed(() => Object.values(brokenMap.value).reduce((sum, n) => sum + n, 0))
const alarmedConfigs = computed(() => rows.value.filter((row) => brokenOf(row) > 0).length)
const healthyConfigs = computed(() => rows.value.length - alarmedConfigs.value)

function brokenOf(row: EntryRow): number {
  return brokenMap.value[String(row['关联任务'] ?? '')] ?? 0
}

/** 只放出当前阶段合法的动作，避免跨阶段操作。 */
function allowedActions(row: EntryRow): string[] {
  const current = String(row.status)
  return meta.actions.filter((action) => {
    const allowed = meta.transitions?.[action]
    return !allowed || allowed.includes(current)
  })
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    brokenMap.value = brokenSealByNode()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '任务监控列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.alert-banner { background: #fee4e2; color: #b42318; border: 1px solid #fda29b; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }
.row-alarm { background: #fff7f6; }
.badge { display: inline-block; border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.badge.ok { background: #dcfae6; color: #067647; }
.badge.danger { background: #fee4e2; color: #b42318; }
.cell-sub { font-size: 12px; margin-top: 2px; }
.danger { color: #b42318; }
.ok { color: #067647; }
.row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
