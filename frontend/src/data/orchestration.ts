/**
 * 转换编排：依赖封印链领域引擎（纯前端，localStorage 持久化）。
 *
 * 规则口径：
 *  1. 每个转换节点点火前，必须持有全部输入表与前置节点的「当前有效签章」，缺一即断签、阻断点火。
 *  2. 失败策略只在波次失败后决定如何收尾，绝不参与点火前置判断（不再被误当作执行条件）。
 *  3. 上游冻结会使下游计划停在断签位置；上游重签后仅续跑未完成波次，旧波次证据不重写。
 *  4. 冻结与点火相撞时按签章顺序（sealOrder）裁决；同一幂等键不会放飞两个实例。
 *  5. 上游断签会留下 SealEvent，监控不再按绿态汇总；回看以转换节点为主对象核对执行波次。
 */
import { listRows, saveRows } from '@/data/local-store'
import { SEED_ROWS } from '@/data/seed'
import type {
  ActionResult,
  EntryRow,
  IdempotencyEntry,
  OrchestrationAudit,
  OrchestrationState,
  Seal,
  SealEvent,
  SealOwnerType,
  TransformRuntime,
  WaveRecord,
} from '@/data/types'

const ORCH_KEY = 'data-layer-studio:orchestration'
const TRANSFORM_MODULE = 'transform'
const TABLE_OWNERS: SealOwnerType = 'table'
const NODE_OWNERS: SealOwnerType = 'node'

export function sealKey(ownerType: SealOwnerType, ownerKey: string): string {
  return `${ownerType}:${ownerKey}`
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function splitList(value: unknown): string[] {
  return String(value ?? '')
    .split(/[,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 从 transform 清单行推导出节点的输入表与前置依赖（清单是主数据，运行态引用它）。 */
function deriveRuntime(row: EntryRow): TransformRuntime {
  return {
    rowId: Number(row.id),
    nodeCode: String(row['节点编号'] ?? ''),
    inputTables: splitList(row['输入表名']),
    upstreamNodes: splitList(row['依赖节点']),
    frozen: false,
    sealSequence: 1,
    failurePolicy: String(row['失败策略'] ?? ''),
    waves: [],
    updatedAt: nowText(),
  }
}

/** 首启种子：TRAN-0001 已冻结（断签），其输入表之一也冻结，复现「上游冻结、计划停在断签位置」。 */
function buildSeedState(): OrchestrationState {
  const rows = clone(SEED_ROWS[TRANSFORM_MODULE]) as EntryRow[]
  const runtimes: Record<string, TransformRuntime> = {}
  const seals: Record<string, Seal> = {}
  const audits: OrchestrationAudit[] = []
  const events: SealEvent[] = []
  let sealOrder = 0
  let eventSeq = 0
  let auditSeq = 0
  const waveSeq: Record<string, number> = {}
  const stamp = '2026-11-13 01:30:00'

  const touchSeal = (ownerType: SealOwnerType, ownerKey: string, frozen: boolean) => {
    sealOrder += 1
    seals[sealKey(ownerType, ownerKey)] = {
      ownerType,
      ownerKey,
      sequence: 1,
      status: frozen ? 'frozen' : 'active',
      updatedAt: stamp,
      updatedBy: '值班管理员',
    }
  }

  for (const row of rows) {
    const runtime = deriveRuntime(row)
    runtimes[runtime.nodeCode] = runtime
    waveSeq[runtime.nodeCode] = 0
    // 每个节点先封印自身（节点签章）
    touchSeal(NODE_OWNERS, runtime.nodeCode, false)
    // 输入表签章
    for (const table of runtime.inputTables) {
      touchSeal(TABLE_OWNERS, table, false)
    }
  }

  // 复现事故现场：TRAN-0001 节点冻结，同时它的一张输入表冻结。
  const frozenNode = 'TRAN-0001'
  const frozenTable = 'ods_order_d'
  sealOrder += 1
  seals[sealKey(NODE_OWNERS, frozenNode)].status = 'frozen'
  seals[sealKey(NODE_OWNERS, frozenNode)].updatedAt = stamp
  sealOrder += 1
  seals[sealKey(TABLE_OWNERS, frozenTable)].status = 'frozen'
  seals[sealKey(TABLE_OWNERS, frozenTable)].updatedAt = stamp
  runtimes[frozenNode].frozen = true
  runtimes[frozenNode].updatedAt = stamp

  eventSeq += 1
  events.push({
    id: eventSeq,
    type: 'freeze',
    ownerType: NODE_OWNERS,
    ownerKey: frozenNode,
    nodeCode: frozenNode,
    sealSequence: seals[sealKey(NODE_OWNERS, frozenNode)].sequence,
    message: `上游节点 ${frozenNode} 已冻结，下游计划在断签位置停摆`,
    createdAt: stamp,
  })
  eventSeq += 1
  events.push({
    id: eventSeq,
    type: 'broken-seal',
    ownerType: TABLE_OWNERS,
    ownerKey: frozenTable,
    nodeCode: frozenNode,
    sealSequence: seals[sealKey(TABLE_OWNERS, frozenTable)].sequence,
    message: `输入表 ${frozenTable} 签章冻结，依赖该表的节点失去当前签章`,
    createdAt: stamp,
  })

  auditSeq += 1
  audits.push({
    id: auditSeq,
    nodeCode: frozenNode,
    action: '冻结节点',
    fromStatus: '已启用',
    toStatus: '已停用',
    sealOrder,
    detail: '事故演练：冻结上游节点并连带输入表断签',
    createdAt: stamp,
    operator: '值班管理员',
  })

  return {
    seals,
    runtimes,
    events,
    idempotency: {},
    audits,
    sealOrder,
    seq: { event: eventSeq, audit: auditSeq, wave: waveSeq },
  }
}

function readState(): OrchestrationState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return buildSeedState()
  }
  const raw = window.localStorage.getItem(ORCH_KEY)
  if (!raw) {
    const seed = buildSeedState()
    window.localStorage.setItem(ORCH_KEY, JSON.stringify(seed))
    return seed
  }
  try {
    return JSON.parse(raw) as OrchestrationState
  } catch {
    const seed = buildSeedState()
    window.localStorage.setItem(ORCH_KEY, JSON.stringify(seed))
    return seed
  }
}

function writeState(state: OrchestrationState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(ORCH_KEY, JSON.stringify(state))
  }
}

/** 清单行变化后（如编辑依赖）把运行态对齐：新增节点补运行态，删除节点清运行态。 */
function syncRuntimes(state: OrchestrationState): void {
  const rows = listRows(TRANSFORM_MODULE)
  const seen = new Set<string>()
  for (const row of rows) {
    const code = String(row['节点编号'] ?? '')
    seen.add(code)
    if (!state.runtimes[code]) {
      const runtime = deriveRuntime(row)
      state.runtimes[code] = runtime
      state.seq.wave[code] = 0
      state.sealOrder += 1
      state.seals[sealKey(NODE_OWNERS, code)] = {
        ownerType: NODE_OWNERS,
        ownerKey: code,
        sequence: 1,
        status: 'active',
        updatedAt: nowText(),
        updatedBy: '值班管理员',
      }
      for (const table of runtime.inputTables) {
        if (!state.seals[sealKey(TABLE_OWNERS, table)]) {
          state.sealOrder += 1
          state.seals[sealKey(TABLE_OWNERS, table)] = {
            ownerType: TABLE_OWNERS,
            ownerKey: table,
            sequence: 1,
            status: 'active',
            updatedAt: nowText(),
            updatedBy: '值班管理员',
          }
        }
      }
    } else {
      // 依赖/输入表/失败策略以清单为准，运行态引用而非复制后漂移
      const runtime = state.runtimes[code]
      runtime.inputTables = splitList(row['输入表名'])
      runtime.upstreamNodes = splitList(row['依赖节点'])
      runtime.failurePolicy = String(row['失败策略'] ?? runtime.failurePolicy)
      for (const table of runtime.inputTables) {
        if (!state.seals[sealKey(TABLE_OWNERS, table)]) {
          state.sealOrder += 1
          state.seals[sealKey(TABLE_OWNERS, table)] = {
            ownerType: TABLE_OWNERS,
            ownerKey: table,
            sequence: 1,
            status: 'active',
            updatedAt: nowText(),
            updatedBy: '值班管理员',
          }
        }
      }
    }
  }
  for (const code of Object.keys(state.runtimes)) {
    if (!seen.has(code)) {
      delete state.runtimes[code]
    }
  }
}

export function loadOrchestration(): OrchestrationState {
  const state = readState()
  syncRuntimes(state)
  writeState(state)
  return state
}

function pushAudit(
  state: OrchestrationState,
  nodeCode: string,
  action: string,
  fromStatus: string,
  toStatus: string,
  detail: string,
  sealOrder = state.sealOrder,
): void {
  state.seq.audit += 1
  state.audits.unshift({
    id: state.seq.audit,
    nodeCode,
    action,
    fromStatus,
    toStatus,
    sealOrder,
    detail,
    createdAt: nowText(),
    operator: '值班管理员',
  })
}

function pushEvent(state: OrchestrationState, event: Omit<SealEvent, 'id' | 'createdAt'>): void {
  state.seq.event += 1
  state.events.unshift({ ...event, id: state.seq.event, createdAt: nowText() })
}

// ===== 签章 / 冻结 / 重签 =====

export type SealView = Seal & { key: string }

export function listSeals(): SealView[] {
  const state = loadOrchestration()
  return Object.entries(state.seals).map(([key, seal]) => ({ ...seal, key }))
}

/** 冻结一个签章（输入表或节点）。节点冻结会同步置运行态 frozen，并对下游产生断签。 */
export function freezeSeal(ownerType: SealOwnerType, ownerKey: string): ActionResult {
  const state = loadOrchestration()
  const seal = state.seals[sealKey(ownerType, ownerKey)]
  if (!seal) {
    return { ok: false, message: `没有找到 ${ownerKey} 的签章，无法冻结` }
  }
  if (seal.status === 'frozen') {
    return { ok: false, message: `${ownerKey} 的签章已经冻结，不用重复操作` }
  }
  state.sealOrder += 1
  seal.status = 'frozen'
  seal.updatedAt = nowText()
  if (ownerType === 'node') {
    const runtime = state.runtimes[ownerKey]
    if (runtime) {
      runtime.frozen = true
      runtime.updatedAt = nowText()
    }
  }
  pushEvent(state, {
    type: 'freeze',
    ownerType,
    ownerKey,
    nodeCode: ownerType === 'node' ? ownerKey : undefined,
    sealSequence: seal.sequence,
    message:
      ownerType === 'node'
        ? `节点 ${ownerKey} 已冻结，依赖它的下游节点进入断签`
        : `输入表 ${ownerKey} 已冻结，引用该表的节点进入断签`,
  })
  pushAudit(
    state,
    ownerType === 'node' ? ownerKey : `表:${ownerKey}`,
    '冻结签章',
    '有效',
    '冻结',
    `冻结 ${ownerType === 'node' ? '节点' : '输入表'} ${ownerKey}，签章顺序 ${state.sealOrder}`,
  )
  writeState(state)
  return { ok: true, message: `${ownerKey} 签章已冻结，签章顺序 ${state.sealOrder}` }
}

/** 重签：只允许对冻结中的签章执行；序号 +1 并恢复有效。旧波次证据保持不动。 */
export function resignSeal(ownerType: SealOwnerType, ownerKey: string): ActionResult {
  const state = loadOrchestration()
  const seal = state.seals[sealKey(ownerType, ownerKey)]
  if (!seal) {
    return { ok: false, message: `没有找到 ${ownerKey} 的签章，无法重签` }
  }
  if (seal.status === 'active') {
    return { ok: false, message: `${ownerKey} 的签章当前有效，无需重签` }
  }
  state.sealOrder += 1
  seal.status = 'active'
  seal.sequence += 1
  seal.updatedAt = nowText()
  if (ownerType === 'node') {
    const runtime = state.runtimes[ownerKey]
    if (runtime) {
      runtime.frozen = false
      runtime.sealSequence = seal.sequence
      runtime.updatedAt = nowText()
    }
  }
  pushEvent(state, {
    type: 're-sign',
    ownerType,
    ownerKey,
    nodeCode: ownerType === 'node' ? ownerKey : undefined,
    sealSequence: seal.sequence,
    message: `${ownerKey} 已重签（第 ${seal.sequence} 版签章），下游可续跑未完成波次，历史波次证据不重写`,
  })
  pushAudit(
    state,
    ownerType === 'node' ? ownerKey : `表:${ownerKey}`,
    '重签签章',
    '冻结',
    '有效',
    `${ownerKey} 重签为第 ${seal.sequence} 版，签章顺序 ${state.sealOrder}`,
  )
  writeState(state)
  return { ok: true, message: `${ownerKey} 已重签，新签章序号 ${seal.sequence}` }
}

// ===== 封印链校验 =====

export type BrokenSeal = {
  ownerType: SealOwnerType
  ownerKey: string
  reason: 'missing' | 'frozen'
}

export type SealChainReport = {
  nodeCode: string
  satisfied: boolean
  /** 节点自身是否冻结 */
  selfFrozen: boolean
  broken: BrokenSeal[]
  /** 点火时应锁定的签章证据 ownerKey -> sequence */
  evidence: Record<string, number>
  sealOrder: number
}

/** 计算节点当前封印链：输入表 + 前置节点的当前签章是否齐备且有效。 */
export function evaluateSealChain(nodeCode: string): SealChainReport {
  const state = loadOrchestration()
  const runtime = state.runtimes[nodeCode]
  const broken: BrokenSeal[] = []
  const evidence: Record<string, number> = {}
  if (!runtime) {
    return { nodeCode, satisfied: false, selfFrozen: false, broken, evidence, sealOrder: state.sealOrder }
  }

  const check = (ownerType: SealOwnerType, ownerKey: string) => {
    const seal = state.seals[sealKey(ownerType, ownerKey)]
    if (!seal) {
      broken.push({ ownerType, ownerKey, reason: 'missing' })
      return
    }
    if (seal.status === 'frozen') {
      broken.push({ ownerType, ownerKey, reason: 'frozen' })
      return
    }
    evidence[sealKey(ownerType, ownerKey)] = seal.sequence
  }

  for (const table of runtime.inputTables) {
    check(TABLE_OWNERS, table)
  }
  for (const upstream of runtime.upstreamNodes) {
    check(NODE_OWNERS, upstream)
  }

  return {
    nodeCode,
    satisfied: broken.length === 0 && !runtime.frozen,
    selfFrozen: runtime.frozen,
    broken,
    evidence,
    sealOrder: state.sealOrder,
  }
}

// ===== 点火（幂等 + 相撞裁决 + 波次） =====

export type IgnitionResult = ActionResult & {
  wave?: WaveRecord
  duplicated?: boolean
}

/**
 * 点火。
 * @param idempotencyKey 幂等键：同一节点同一键只放飞一个实例，重复请求直接返回既有波次。
 * @param failForDemo 演示用：置 true 时让本波次失败，失败策略随后才介入。
 */
export function ignite(nodeCode: string, idempotencyKey: string, failForDemo = false): IgnitionResult {
  const state = loadOrchestration()
  const runtime = state.runtimes[nodeCode]
  if (!runtime) {
    return { ok: false, message: `没有找到转换节点 ${nodeCode}` }
  }
  const key = `${nodeCode}::${idempotencyKey}`
  const existing = state.idempotency[key]
  if (existing) {
    const wave = runtime.waves.find((item) => item.waveNo === existing.waveNo)
    return {
      ok: true,
      duplicated: true,
      wave,
      message: `幂等键 ${idempotencyKey} 已放飞波次 W${existing.waveNo}，不重复创建实例`,
    }
  }

  // 点火瞬间先占用一个签章顺序，随后与现存冻结签章比较——相撞按顺序裁决。
  state.sealOrder += 1
  const ignitionOrder = state.sealOrder

  // 节点自身被冻结：比较冻结签章顺序与点火顺序，冻结在先则阻断（这是常态相撞裁决）。
  const selfSeal = state.seals[sealKey(NODE_OWNERS, nodeCode)]
  if (runtime.frozen || (selfSeal && selfSeal.status === 'frozen')) {
    pushEvent(state, {
      type: 'ignition-blocked',
      ownerType: NODE_OWNERS,
      ownerKey: nodeCode,
      nodeCode,
      sealSequence: selfSeal?.sequence ?? 0,
      message: `节点 ${nodeCode} 自身签章已冻结（签章顺序先于点火顺序 ${ignitionOrder}），点火被裁决阻断`,
    })
    writeState(state)
    return { ok: false, message: `节点 ${nodeCode} 已冻结，冻结签章顺序在先，点火被阻断` }
  }

  const report = evaluateSealChain(nodeCode)
  if (!report.satisfied) {
    const detail = report.broken
      .map((item) => `${item.ownerType === 'table' ? '输入表' : '前置节点'} ${item.ownerKey}${
        item.reason === 'frozen' ? '签章冻结' : '缺少签章'
      }`)
      .join('；')
    state.seq.wave[nodeCode] = (state.seq.wave[nodeCode] ?? 0) + 1
    const waveNo = state.seq.wave[nodeCode]
    const blockedWave: WaveRecord = {
      waveNo,
      idempotencyKey,
      status: 'blocked',
      evidence: report.evidence,
      sealOrder: ignitionOrder,
      reason: `断签阻断：${detail}`,
      startedAt: nowText(),
      finishedAt: nowText(),
    }
    runtime.waves.unshift(blockedWave)
    runtime.updatedAt = nowText()
    pushEvent(state, {
      type: 'ignition-blocked',
      ownerType: NODE_OWNERS,
      ownerKey: nodeCode,
      nodeCode,
      sealSequence: runtime.sealSequence,
      message: `${nodeCode} 点火在断签位置停摆：${detail}`,
    })
    pushAudit(state, nodeCode, '点火阻断', runtime.failurePolicy, '阻断', `波次 W${waveNo} 未放飞：${detail}`, ignitionOrder)
    writeState(state)
    return { ok: false, wave: blockedWave, message: `封印链不完整，计划停在断签位置：${detail}` }
  }

  // 封印链齐备：登记幂等键并放飞波次，证据锁定当前全部签章序号。
  state.seq.wave[nodeCode] = (state.seq.wave[nodeCode] ?? 0) + 1
  const waveNo = state.seq.wave[nodeCode]
  const entry: IdempotencyEntry = { key, nodeCode, waveNo, createdAt: nowText() }
  state.idempotency[key] = entry

  const wave: WaveRecord = {
    waveNo,
    idempotencyKey,
    status: failForDemo ? 'failed' : 'succeeded',
    evidence: { ...report.evidence },
    sealOrder: ignitionOrder,
    startedAt: nowText(),
    finishedAt: nowText(),
  }
  if (failForDemo) {
    // 失败策略此时才介入：它只决定失败后的收尾，不参与点火前置。
    wave.reason = `波次执行失败，按失败策略「${runtime.failurePolicy}」收尾`
  }
  runtime.waves.unshift(wave)
  runtime.updatedAt = nowText()

  pushEvent(state, {
    type: 'ignition-ok',
    ownerType: NODE_OWNERS,
    ownerKey: nodeCode,
    nodeCode,
    sealSequence: runtime.sealSequence,
    message: failForDemo
      ? `${nodeCode} 波次 W${waveNo} 已放飞但执行失败，失败策略「${runtime.failurePolicy}」介入`
      : `${nodeCode} 波次 W${waveNo} 点火成功，签章证据已锁定`,
  })
  pushAudit(
    state,
    nodeCode,
    failForDemo ? '点火失败' : '点火成功',
    '已启用',
    failForDemo ? '失败收尾' : '已启用',
    `波次 W${waveNo}，幂等键 ${idempotencyKey}，签章顺序 ${ignitionOrder}`,
    ignitionOrder,
  )
  writeState(state)
  return {
    ok: !failForDemo,
    wave,
    message: failForDemo
      ? `波次 W${waveNo} 失败，已按「${runtime.failurePolicy}」处理`
      : `波次 W${waveNo} 点火成功，签章证据已锁定`,
  }
}

/** 续跑：上游重签后只处理未完成（blocked / failed / running）波次，成功波次的证据不重写。 */
export function resumePendingWaves(nodeCode: string): ActionResult & { resumed: number } {
  const state = loadOrchestration()
  const runtime = state.runtimes[nodeCode]
  if (!runtime) {
    return { ok: false, message: `没有找到转换节点 ${nodeCode}`, resumed: 0 }
  }
  const report = evaluateSealChain(nodeCode)
  if (!report.satisfied) {
    return {
      ok: false,
      resumed: 0,
      message: `封印链仍不完整（${report.broken
        .map((item) => item.ownerKey)
        .join('、')}），续跑继续停在断签位置`,
    }
  }
  const pending = runtime.waves.filter((wave) => wave.status === 'blocked' || wave.status === 'failed' || wave.status === 'running')
  if (pending.length === 0) {
    return { ok: true, resumed: 0, message: '没有未完成波次，无需续跑；历史波次证据保持不变' }
  }
  state.sealOrder += 1
  for (const wave of pending) {
    // 只补跑未完成波次：旧证据保留，追加新的签章顺序备注，不覆盖原 evidence。
    wave.status = 'succeeded'
    wave.reason = `上游重签后续跑完成（原状态证据保留，续跑签章顺序 ${state.sealOrder}）`
    wave.finishedAt = nowText()
  }
  runtime.updatedAt = nowText()
  pushAudit(
    state,
    nodeCode,
    '续跑波次',
    '断签停摆',
    '已补齐',
    `续跑 ${pending.length} 个未完成波次，已成功波次的历史证据不重写`,
  )
  writeState(state)
  return { ok: true, resumed: pending.length, message: `已续跑 ${pending.length} 个未完成波次，旧波次证据未重写` }
}

// ===== 查询：回看以转换节点为主对象 =====

export type NodeRuntimeView = TransformRuntime & {
  nodeCode: string
  chain: SealChainReport
  row?: EntryRow
}

export function listNodeRuntimes(): NodeRuntimeView[] {
  const state = loadOrchestration()
  const rows = listRows(TRANSFORM_MODULE)
  const rowByCode = new Map(rows.map((row) => [String(row['节点编号']), row]))
  return Object.values(state.runtimes).map((runtime) => ({
    ...clone(runtime),
    chain: evaluateSealChain(runtime.nodeCode),
    row: rowByCode.get(runtime.nodeCode),
  }))
}

export function getNodeRuntime(nodeCode: string): NodeRuntimeView | undefined {
  return listNodeRuntimes().find((item) => item.nodeCode === nodeCode)
}

export function listEvents(): SealEvent[] {
  return clone(loadOrchestration().events)
}

export function listAudits(nodeCode?: string): OrchestrationAudit[] {
  const audits = loadOrchestration().audits
  return clone(nodeCode ? audits.filter((item) => item.nodeCode === nodeCode) : audits)
}

/** 断签数：监控与概览不再按绿态汇总的依据。 */
export function countBrokenSeals(): number {
  const state = loadOrchestration()
  return Object.values(state.runtimes).reduce(
    (sum, runtime) => sum + evaluateSealChain(runtime.nodeCode).broken.length + (runtime.frozen ? 1 : 0),
    0,
  )
}

/** 每个关联节点当前的断签数，供任务监控页对账（MONI 不再假装全绿）。 */
export function brokenSealByNode(): Record<string, number> {
  const result: Record<string, number> = {}
  for (const runtime of Object.values(loadOrchestration().runtimes)) {
    const report = evaluateSealChain(runtime.nodeCode)
    result[runtime.nodeCode] = report.broken.length + (runtime.frozen ? 1 : 0)
  }
  return result
}

/** 重置编排运行态（连同清单重置一起调用）。 */
export function resetOrchestration(): void {
  const seed = buildSeedState()
  writeState(seed)
  saveRows(TRANSFORM_MODULE, clone(SEED_ROWS[TRANSFORM_MODULE]) as EntryRow[])
}
