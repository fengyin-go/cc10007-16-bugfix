<template>
  <section class="page" data-module="transform">
    <header class="page-head">
      <div>
        <h2>转换编排管理</h2>
        <p class="page-desc">
          点火前必须持有全部输入表与前置节点的当前签章；上游冻结使计划停在断签位置，重签后续跑未完成波次，旧波次证据不重写。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出转换编排清单</button>
        <button class="btn ghost" type="button" @click="resetAll">复位演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">转换节点总数</span>
        <strong class="stat-value">{{ runtimes.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">封印链齐备</span>
        <strong class="stat-value ok">{{ satisfiedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">断签节点</span>
        <strong class="stat-value" :class="{ danger: brokenCount > 0 }">{{ brokenCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">全局签章顺序</span>
        <strong class="stat-value">{{ state?.sealOrder ?? 0 }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <label class="legend-item">
        <input v-model="includeArchived" type="checkbox" @change="reload" /> 显示已归档
      </label>
    </p>

    <h3 class="section-title">封印链与点火</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>节点编号</th>
          <th>输入表 / 前置节点签章</th>
          <th>封印链</th>
          <th>失败策略</th>
          <th>当前状态</th>
          <th>编排操作</th>
          <th>生命周期</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="view in runtimes" :key="view.nodeCode" :class="{ 'row-frozen': view.frozen }">
          <td>
            <RouterLink :to="`/transform/${view.rowId}`" class="link">{{ view.nodeCode }}</RouterLink>
            <div class="cell-sub">{{ view.row?.['输出表名'] }}</div>
          </td>
          <td>
            <div v-for="table in view.inputTables" :key="table" class="seal-line">
              <span class="seal-dot" :class="sealClass('table', table)"></span>
              表 {{ table }}
              <em class="seal-seq">v{{ sealOf('table', table)?.sequence ?? '-' }}
                {{ sealOf('table', table)?.status === 'frozen' ? '冻结' : '有效' }}</em>
            </div>
            <div v-for="up in view.upstreamNodes" :key="up" class="seal-line">
              <span class="seal-dot" :class="sealClass('node', up)"></span>
              前置 {{ up }}
              <em class="seal-seq">v{{ sealOf('node', up)?.sequence ?? '-' }}
                {{ sealOf('node', up)?.status === 'frozen' ? '冻结' : '无签章' }}</em>
            </div>
            <div v-if="!view.inputTables.length && !view.upstreamNodes.length" class="cell-sub">无外部依赖</div>
          </td>
          <td>
            <span v-if="view.chain.satisfied" class="badge ok">齐备可点火</span>
            <div v-else>
              <strong class="danger">断签停摆</strong>
              <ul class="broken-list">
                <li v-for="b in view.chain.broken" :key="`${b.ownerType}-${b.ownerKey}`">
                  {{ b.ownerType === 'table' ? '输入表' : '前置节点' }} {{ b.ownerKey }}
                  （{{ b.reason === 'frozen' ? '签章冻结' : '缺少签章' }}）
                </li>
                <li v-if="view.chain.selfFrozen">节点自身已冻结</li>
              </ul>
            </div>
          </td>
          <td>
            {{ view.failurePolicy }}
            <div class="cell-sub">仅波次失败后生效，不参与点火前置</div>
          </td>
          <td>
            <span class="badge" :class="statusBadge(view.row?.status)">{{ view.row?.status ?? '—' }}</span>
            <div v-if="view.frozen" class="cell-sub danger">节点冻结中</div>
          </td>
          <td class="row-actions wrap">
            <button class="link" type="button" @click="onIgnite(view.nodeCode, false)">点火</button>
            <button class="link" type="button" @click="onIgnite(view.nodeCode, true)">点火(演示失败)</button>
            <button class="link" type="button" @click="onFreeze(view.nodeCode)">冻结节点</button>
            <button class="link" type="button" @click="onResign(view.nodeCode)">重签节点</button>
            <button class="link" type="button" @click="onResume(view.nodeCode)">续跑未完成波次</button>
            <RouterLink class="link" :to="`/transform/${view.rowId}`">执行波次回看</RouterLink>
          </td>
          <td class="row-actions wrap">
            <button
              v-for="action in lifecycleActions(view.row)"
              :key="action"
              class="link"
              type="button"
              @click="onLifecycle(action, view.row!)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!runtimes.length">
          <td colspan="7" class="empty-state">暂无转换节点</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">签章台账（输入表与节点签章）</h3>
    <table class="data-table">
      <thead>
        <tr><th>归属</th><th>对象</th><th>签章序号</th><th>状态</th><th>更新时间</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="seal in seals" :key="seal.key" :class="{ 'row-frozen': seal.status === 'frozen' }">
          <td>{{ seal.ownerType === 'table' ? '输入表' : '转换节点' }}</td>
          <td>{{ seal.ownerKey }}</td>
          <td>v{{ seal.sequence }}</td>
          <td>
            <span class="badge" :class="seal.status === 'active' ? 'ok' : 'danger'">
              {{ seal.status === 'active' ? '有效' : '冻结' }}
            </span>
          </td>
          <td>{{ seal.updatedAt }}</td>
          <td class="row-actions">
            <button v-if="seal.status === 'active'" class="link" type="button" @click="onFreezeSeal(seal)">冻结</button>
            <button v-else class="link" type="button" @click="onResignSeal(seal)">重签恢复</button>
          </td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">断签与编排事件（监控对账依据，不再按绿态汇总）</h3>
    <table class="data-table">
      <thead>
        <tr><th>时间</th><th>类型</th><th>对象</th><th>关联节点</th><th>签章序号</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr v-for="event in events" :key="event.id">
          <td>{{ event.createdAt }}</td>
          <td><span class="badge" :class="eventBadge(event.type)">{{ eventTypeLabel(event.type) }}</span></td>
          <td>{{ event.ownerKey }}</td>
          <td>{{ event.nodeCode ?? '—' }}</td>
          <td>v{{ event.sealSequence }}</td>
          <td>{{ event.message }}</td>
        </tr>
        <tr v-if="!events.length">
          <td colspan="6" class="empty-state">暂无事件</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ runtimes.length }} 个转换节点，数据保存在本机浏览器</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  resetModule,
  runAction as applyAction,
} from '@/api/local-service'
import {
  freezeSeal,
  ignite,
  listEvents,
  listNodeRuntimes,
  listSeals,
  loadOrchestration,
  resignSeal,
  resumePendingWaves,
} from '@/data/orchestration'
import type { NodeRuntimeView } from '@/data/orchestration'
import type { EntryRow, OrchestrationState, Seal, SealEvent, SealOwnerType } from '@/data/types'

const meta = moduleMeta('transform')
const statuses = ['草稿', '待校验', '已启用', '已停用', '已归档']

const runtimes = ref<NodeRuntimeView[]>([])
const seals = ref<(Seal & { key: string })[]>([])
const events = ref<SealEvent[]>([])
const state = ref<OrchestrationState | null>(null)
const includeArchived = ref(false)
const message = ref('')
const messageOk = ref(true)

const satisfiedCount = computed(() => runtimes.value.filter((item) => item.chain.satisfied).length)
const brokenCount = computed(() => runtimes.value.filter((item) => !item.chain.satisfied).length)

const statusSummary = computed(() => {
  const rows = listEntries(meta.key, {}, includeArchived.value).items
  return statuses.map((status) => ({
    status,
    count: rows.filter((row) => String(row.status) === status).length,
  }))
})

function sealOf(ownerType: SealOwnerType, ownerKey: string): Seal | undefined {
  return seals.value.find((item) => item.ownerType === ownerType && item.ownerKey === ownerKey)
}

function sealClass(ownerType: SealOwnerType, ownerKey: string): string {
  const seal = sealOf(ownerType, ownerKey)
  if (!seal) return 'missing'
  return seal.status === 'active' ? 'active' : 'frozen'
}

function statusBadge(status?: string): string {
  if (status === '已启用') return 'ok'
  if (status === '已停用' || status === '已归档') return 'danger'
  return 'warn'
}

function eventBadge(type: SealEvent['type']): string {
  if (type === 'ignition-ok' || type === 're-sign') return 'ok'
  if (type === 'ignition-blocked' || type === 'broken-seal' || type === 'freeze') return 'danger'
  return 'warn'
}

function eventTypeLabel(type: SealEvent['type']): string {
  const map: Record<SealEvent['type'], string> = {
    'broken-seal': '断签',
    're-sign': '重签',
    freeze: '冻结',
    'ignition-blocked': '点火阻断',
    'ignition-ok': '点火成功',
  }
  return map[type]
}

/** 按状态机只放出当前阶段合法的生命周期动作。 */
function lifecycleActions(row?: EntryRow): string[] {
  if (!row) return []
  const current = String(row.status)
  return meta.actions.filter((action) => {
    const allowed = meta.transitions?.[action]
    return !allowed || allowed.includes(current)
  })
}

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function reload() {
  message.value = ''
  state.value = loadOrchestration()
  runtimes.value = listNodeRuntimes().filter((view) =>
    includeArchived.value ? true : String(view.row?.status) !== '已归档',
  )
  seals.value = listSeals()
  events.value = listEvents()
}

function exportRows() {
  downloadEntries(meta.key)
}

function resetAll() {
  resetModule(meta.key)
  reload()
  notify(true, '演示数据已复位：TRAN-0001 重新冻结，断签现场还原')
}

function onIgnite(nodeCode: string, failForDemo: boolean) {
  // 幂等键用 节点+分钟级时间戳，同一分钟内重复点击只会拿到同一个波次实例。
  const idempotencyKey = `${nodeCode}-${new Date().toISOString().slice(0, 16)}`
  const result = ignite(nodeCode, idempotencyKey, failForDemo)
  reload()
  notify(result.ok, result.duplicated ? result.message : result.message)
}

function onFreeze(nodeCode: string) {
  const result = freezeSeal('node', nodeCode)
  reload()
  notify(result.ok, result.message)
}

function onResign(nodeCode: string) {
  const result = resignSeal('node', nodeCode)
  reload()
  notify(result.ok, result.message)
}

function onResume(nodeCode: string) {
  const result = resumePendingWaves(nodeCode)
  reload()
  notify(result.ok, result.message)
}

function onFreezeSeal(seal: Seal) {
  const result = freezeSeal(seal.ownerType, seal.ownerKey)
  reload()
  notify(result.ok, result.message)
}

function onResignSeal(seal: Seal) {
  const result = resignSeal(seal.ownerType, seal.ownerKey)
  reload()
  notify(result.ok, result.message)
}

function onLifecycle(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action)
  reload()
  notify(result.ok, result.message)
}

onMounted(reload)
</script>

<style scoped>
.section-title { font-size: 15px; margin: 18px 0 8px; }
.cell-sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
.seal-line { display: flex; align-items: center; gap: 6px; font-size: 12px; margin: 2px 0; }
.seal-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.seal-dot.active { background: #12b76a; }
.seal-dot.frozen { background: #f04438; }
.seal-dot.missing { background: #f79009; }
.seal-seq { font-style: normal; color: var(--muted); font-size: 11px; }
.badge { display: inline-block; border-radius: 999px; padding: 2px 10px; font-size: 12px; background: #eef2f7; }
.badge.ok { background: #dcfae6; color: #067647; }
.badge.danger { background: #fee4e2; color: #b42318; }
.badge.warn { background: #fef0c7; color: #b54708; }
.row-frozen { background: #fff7f6; }
.row-actions.wrap { flex-wrap: wrap; max-width: 220px; }
.broken-list { margin: 4px 0 0; padding-left: 16px; font-size: 12px; color: #b42318; }
.ok-text { color: #067647; }
.danger { color: #b42318; }
.ok { color: #067647; }
</style>
