<template>
  <section class="page" data-module="transform-detail">
    <header class="page-head">
      <div>
        <h2>转换节点详情 · {{ runtime?.nodeCode ?? '加载中' }}</h2>
        <p class="page-desc">
          回看以转换编排为主对象：核对每个执行波次锁定的签章证据、幂等键与裁决顺序。详情始终读取主存储当前值。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/transform">返回转换编排列表</RouterLink>
      </div>
    </header>

    <div v-if="!runtime" class="empty-state">没有找到该转换节点，可能已被删除。</div>
    <template v-else>
      <article class="detail-card">
        <h3>节点档案（清单主数据）</h3>
        <dl class="detail-grid">
          <div v-for="field in meta.fields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ row?.[field] ?? '—' }}</dd>
          </div>
          <div>
            <dt>当前状态</dt>
            <dd><span class="badge" :class="statusBadge(row?.status)">{{ row?.status ?? '—' }}</span></dd>
          </div>
          <div>
            <dt>节点冻结</dt>
            <dd :class="runtime.frozen ? 'danger' : 'ok'">{{ runtime.frozen ? '冻结中（不可点火）' : '未冻结' }}</dd>
          </div>
          <div>
            <dt>节点签章序号</dt>
            <dd>v{{ runtime.sealSequence }}</dd>
          </div>
        </dl>
      </article>

      <article class="detail-card">
        <h3>封印链核验</h3>
        <p v-if="runtime.chain.satisfied" class="ok-text">
          ✓ 全部输入表与前置节点均持有当前有效签章，证据 {{ evidenceSummary }}，可点火。
        </p>
        <div v-else>
          <p class="danger">✗ 封印链不完整，计划停在断签位置：</p>
          <ul class="broken-list">
            <li v-for="b in runtime.chain.broken" :key="`${b.ownerType}-${b.ownerKey}`">
              {{ b.ownerType === 'table' ? '输入表' : '前置节点' }} {{ b.ownerKey }}
              （{{ b.reason === 'frozen' ? '签章冻结' : '缺少签章' }}）
            </li>
            <li v-if="runtime.chain.selfFrozen">节点自身签章已冻结</li>
          </ul>
        </div>
        <p class="cell-sub">核验时全局签章顺序：{{ runtime.chain.sealOrder }}</p>
      </article>

      <article class="detail-card">
        <h3>执行波次回看（{{ runtime.waves.length }} 个波次）</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>波次</th>
              <th>幂等键</th>
              <th>状态</th>
              <th>点火签章顺序</th>
              <th>锁定签章证据</th>
              <th>开始/结束</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="wave in runtime.waves" :key="wave.waveNo">
              <td>W{{ wave.waveNo }}</td>
              <td class="mono">{{ wave.idempotencyKey }}</td>
              <td><span class="badge" :class="waveBadge(wave.status)">{{ waveLabel(wave.status) }}</span></td>
              <td>{{ wave.sealOrder }}</td>
              <td class="mono small">{{ formatEvidence(wave.evidence) }}</td>
              <td class="small">{{ wave.startedAt }}<br />{{ wave.finishedAt ?? '—' }}</td>
              <td class="small">{{ wave.reason ?? '—' }}</td>
            </tr>
            <tr v-if="!runtime.waves.length">
              <td colspan="7" class="empty-state">尚无执行波次，可在列表页点火</td>
            </tr>
          </tbody>
        </table>
        <p class="cell-sub">旧波次证据在重签/续跑后保持原值不重写，仅未完成波次会被续跑处理。</p>
      </article>

      <article class="detail-card">
        <h3>编排审计（本节点）</h3>
        <table class="data-table">
          <thead>
            <tr><th>时间</th><th>动作</th><th>阶段变化</th><th>签章顺序</th><th>说明</th><th>操作人</th></tr>
          </thead>
          <tbody>
            <tr v-for="audit in audits" :key="audit.id">
              <td class="small">{{ audit.createdAt }}</td>
              <td>{{ audit.action }}</td>
              <td>{{ audit.fromStatus }} → {{ audit.toStatus }}</td>
              <td>{{ audit.sealOrder }}</td>
              <td class="small">{{ audit.detail }}</td>
              <td>{{ audit.operator }}</td>
            </tr>
            <tr v-if="!audits.length">
              <td colspan="6" class="empty-state">暂无审计记录</td>
            </tr>
          </tbody>
        </table>
      </article>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getEntry, moduleMeta } from '@/api/local-service'
import { getNodeRuntime, listAudits } from '@/data/orchestration'
import type { NodeRuntimeView } from '@/data/orchestration'
import type { EntryRow, OrchestrationAudit, WaveRecord } from '@/data/types'

const route = useRoute()
const meta = moduleMeta('transform')

const runtime = ref<NodeRuntimeView | undefined>()
const row = ref<EntryRow | undefined>()
const audits = ref<OrchestrationAudit[]>([])

const nodeCode = computed(() => runtime.value?.nodeCode ?? '')
const evidenceSummary = computed(() =>
  runtime.value ? Object.entries(runtime.value.chain.evidence).map(([k, v]) => `${k}=v${v}`).join('，') : '',
)

function formatEvidence(evidence: Record<string, number>): string {
  return Object.entries(evidence)
    .map(([key, seq]) => `${key.replace(/^(table|node):/, '$1/')}=v${seq}`)
    .join('\n')
}

function waveBadge(status: WaveRecord['status']): string {
  if (status === 'succeeded') return 'ok'
  if (status === 'failed' || status === 'blocked') return 'danger'
  return 'warn'
}

function waveLabel(status: WaveRecord['status']): string {
  const map: Record<WaveRecord['status'], string> = {
    running: '运行中',
    succeeded: '成功',
    failed: '失败',
    blocked: '断签阻断',
  }
  return map[status]
}

function statusBadge(status?: string): string {
  if (status === '已启用') return 'ok'
  if (status === '已停用' || status === '已归档') return 'danger'
  return 'warn'
}

function load() {
  const id = Number(route.params.id)
  row.value = getEntry('transform', id)
  const code = row.value ? String(row.value['节点编号']) : ''
  runtime.value = code ? getNodeRuntime(code) : undefined
  audits.value = code ? listAudits(code) : []
}

onMounted(load)
watch(() => route.params.id, load)
</script>

<style scoped>
.detail-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 14px; }
.detail-card h3 { margin: 0 0 10px; font-size: 15px; }
.detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 18px; margin: 0; }
.detail-grid dt { color: var(--muted); font-size: 12px; }
.detail-grid dd { margin: 2px 0 0; font-size: 13px; }
.badge { display: inline-block; border-radius: 999px; padding: 2px 10px; font-size: 12px; background: #eef2f7; }
.badge.ok { background: #dcfae6; color: #067647; }
.badge.danger { background: #fee4e2; color: #b42318; }
.badge.warn { background: #fef0c7; color: #b54708; }
.ok-text { color: #067647; }
.danger { color: #b42318; }
.broken-list { margin: 4px 0; padding-left: 18px; color: #b42318; font-size: 13px; }
.cell-sub { color: var(--muted); font-size: 12px; }
.mono { font-family: ui-monospace, Menlo, monospace; word-break: break-all; }
.small { font-size: 12px; }
</style>
