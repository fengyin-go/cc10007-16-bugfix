/* 依赖封印链领域规则端到端验证：localStorage shim + 断言，纯 node 运行。 */
import assert from 'node:assert'
import test from 'node:test'

// localStorage shim
const store = new Map<string, string>()
globalThis.window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
} as unknown as Window & typeof globalThis

const orch = await import('../src/data/orchestration.ts')
const service = await import('../src/api/local-service.ts')

function reset() {
  store.clear()
  orch.resetOrchestration()
}

test('初始现场：TRAN-0001 冻结，TRAN-0002 因前置断签不能点火（失败策略不构成执行条件）', () => {
  reset()
  const r1 = orch.evaluateSealChain('TRAN-0001')
  assert.equal(r1.satisfied, false)
  assert.equal(r1.selfFrozen, true)
  const r2 = orch.evaluateSealChain('TRAN-0002')
  assert.equal(r2.satisfied, false)
  assert.ok(r2.broken.some((b) => b.ownerKey === 'TRAN-0001' && b.reason === 'frozen'))
  // 点火被阻断，且产生 blocked 波次与断签事件
  const ign = orch.ignite('TRAN-0002', 'wave-day1')
  assert.equal(ign.ok, false)
  assert.equal(ign.wave?.status, 'blocked')
  const view = orch.getNodeRuntime('TRAN-0002')!
  assert.equal(view.waves[0].status, 'blocked')
  assert.ok(orch.listEvents().some((e) => e.type === 'ignition-blocked'))
})

test('同一幂等键不会放飞两个实例', () => {
  reset()
  // TRAN-0003 无断签（其依赖 TRAN-0002 签章 active），可点火
  const first = orch.ignite('TRAN-0003', 'idem-xyz')
  assert.equal(first.ok, true)
  const second = orch.ignite('TRAN-0003', 'idem-xyz')
  assert.equal(second.ok, true)
  assert.equal(second.duplicated, true)
  const view = orch.getNodeRuntime('TRAN-0003')!
  assert.equal(view.waves.length, 1)
  assert.equal(view.waves[0].idempotencyKey, 'idem-xyz')
})

test('重签后续跑只处理未完成波次，旧波次证据不重写', () => {
  reset()
  // 先制造 TRAN-0002 的 blocked 波次
  const blocked = orch.ignite('TRAN-0002', 'w-blocked')
  assert.equal(blocked.ok, false)
  const before = orch.getNodeRuntime('TRAN-0002')!.waves[0]
  const evidenceBefore = JSON.stringify(before.evidence)
  // 重签冻结的前置节点与冻结输入表
  assert.equal(orch.resignSeal('node', 'TRAN-0001').ok, true)
  assert.equal(orch.resignSeal('table', 'ods_order_d').ok, true)
  const chain = orch.evaluateSealChain('TRAN-0002')
  assert.equal(chain.satisfied, true)
  // 续跑
  const resume = orch.resumePendingWaves('TRAN-0002')
  assert.equal(resume.ok, true)
  assert.equal(resume.resumed, 1)
  const after = orch.getNodeRuntime('TRAN-0002')!.waves[0]
  assert.equal(after.status, 'succeeded')
  // 旧证据（点火时锁定的签章快照）保持原值，不被重写
  assert.equal(JSON.stringify(after.evidence), evidenceBefore)
  // 已成功的 TRAN-0003 波次不会被重复处理
  orch.ignite('TRAN-0003', 'keep-1')
  const again = orch.resumePendingWaves('TRAN-0003')
  assert.equal(again.resumed, 0)
})

test('冻结与点火相撞按签章顺序裁决：先冻结后点火则阻断', () => {
  reset()
  // TRAN-0003 当前可点火；先冻结它，再点火
  assert.equal(orch.freezeSeal('node', 'TRAN-0003').ok, true)
  const ign = orch.ignite('TRAN-0003', 'race-1')
  assert.equal(ign.ok, false)
  assert.match(ign.message, /冻结签章顺序在先|已冻结/)
})

test('失败策略只在波次失败后介入，不参与点火前置判断', () => {
  reset()
  const okIgnite = orch.ignite('TRAN-0003', 'fail-demo', true)
  assert.equal(okIgnite.ok, false)
  assert.equal(okIgnite.wave?.status, 'failed')
  assert.match(okIgnite.wave?.reason ?? '', /失败策略/)
})

test('监控与概览不再按绿态汇总：断签数 > 0', () => {
  reset()
  assert.ok(orch.countBrokenSeals() > 0)
  const byNode = orch.brokenSealByNode()
  assert.ok((byNode['TRAN-0001'] ?? 0) > 0)
  assert.ok((byNode['TRAN-0002'] ?? 0) > 0)
})

test('对象生命周期按阶段变更，恢复与归档绑定当前状态', () => {
  reset()
  // TRAN-0001 清单状态为「已停用」
  const row = service.listEntries('transform').items.find((r) => r['节点编号'] === 'TRAN-0001')!
  assert.equal(row.status, '已停用')
  // 已停用不能直接启用（启用只允许待校验）
  const invalid = service.runAction('transform', Number(row.id), '启用节点')
  assert.equal(invalid.ok, false)
  // 已停用可以归档
  const archived = service.runAction('transform', Number(row.id), '归档节点')
  assert.equal(archived.ok, true)
  // 归档后默认列表不再残留该对象
  assert.ok(!service.listEntries('transform').items.some((r) => Number(r.id) === Number(row.id)))
  // 但详情仍能读到真实值（列表/详情口径一致，不丢数据）
  const detail = service.getEntry('transform', Number(row.id))!
  assert.equal(detail.status, '已归档')
  // 归档态只能恢复，恢复回到草稿
  const restored = service.runAction('transform', Number(row.id), '恢复节点')
  assert.equal(restored.ok, true)
  assert.equal(service.getEntry('transform', Number(row.id))!.status, '草稿')
})
