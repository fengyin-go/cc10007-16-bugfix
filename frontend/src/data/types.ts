/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  /** 状态机：key 为动作名，value 为允许发起该动作的当前阶段白名单。
   *  没登记的动作沿用旧的通用流转，登记了就必须命中当前阶段，恢复/归档因此绑定对象当前状态。 */
  transitions?: Record<string, string[]>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// ===== 转换编排：依赖封印链领域模型 =====

/** 签章归属：输入表或前置转换节点 */
export type SealOwnerType = 'table' | 'node'

/** 签章本身的生命周期：有效 / 冻结（断签） */
export type SealStatus = 'active' | 'frozen'

export type Seal = {
  ownerType: SealOwnerType
  /** 输入表名 或 转换节点编号 */
  ownerKey: string
  /** 单调递增的签章序号，重签一次 +1，冻结与点火相撞时按序号裁决 */
  sequence: number
  status: SealStatus
  updatedAt: string
  updatedBy: string
}

/** 转换节点的编排生命周期阶段 */
export type TransformLifecycle =
  | '草稿'
  | '待校验'
  | '已启用'
  | '已停用'
  | '已归档'

/** 单个执行波次：一个幂等键对应至多一个实例，旧波次证据永不重写 */
export type WaveRecord = {
  waveNo: number
  idempotencyKey: string
  status: 'running' | 'succeeded' | 'failed' | 'blocked'
  /** 点火时锁定的全部签章快照（ownerKey -> sequence），作为该波次的证据 */
  evidence: Record<string, number>
  /** 点火时所依据的全局签章顺序 */
  sealOrder: number
  reason?: string
  startedAt: string
  finishedAt?: string
}

/** 转换节点的运行态：编排生命周期与执行波次都挂在这里，转换编排始终是主对象 */
export type TransformRuntime = {
  /** 对应 transform 清单行的 id */
  rowId: number
  nodeCode: string
  /** 输入表名集合，点火前必须持有这些表的当前有效签章 */
  inputTables: string[]
  /** 前置节点编号集合，点火前必须持有这些节点的当前有效签章 */
  upstreamNodes: string[]
  /** 节点自身签章是否冻结（节点被冻结后不能点火） */
  frozen: boolean
  /** 节点当前签章序号 */
  sealSequence: number
  /** 失败策略只在波次失败后生效，绝不参与点火前置判断 */
  failurePolicy: string
  waves: WaveRecord[]
  updatedAt: string
}

/** 断签事件：上游冻结留下的痕迹，监控据此不再按绿态汇总 */
export type SealEvent = {
  id: number
  type: 'broken-seal' | 're-sign' | 'freeze' | 'ignition-blocked' | 'ignition-ok'
  ownerType: SealOwnerType
  ownerKey: string
  nodeCode?: string
  sealSequence: number
  message: string
  createdAt: string
}

/** 幂等登记表：同一幂等键不会放飞两个实例 */
export type IdempotencyEntry = {
  key: string
  nodeCode: string
  waveNo: number
  createdAt: string
}

/** 编排领域审计：阶段变更、冻结、重签、点火都落痕，回看以转换编排为主对象 */
export type OrchestrationAudit = {
  id: number
  nodeCode: string
  action: string
  fromStatus: string
  toStatus: string
  sealOrder: number
  detail: string
  createdAt: string
  operator: string
}

/** 整个封印链运行态，独立持久化，不与清单行混存 */
export type OrchestrationState = {
  /** `${ownerType}:${ownerKey}` -> Seal */
  seals: Record<string, Seal>
  runtimes: Record<string, TransformRuntime>
  events: SealEvent[]
  idempotency: Record<string, IdempotencyEntry>
  audits: OrchestrationAudit[]
  /** 全局签章顺序，每次封印/冻结/重签/点火都 +1，用于相撞裁决 */
  sealOrder: number
  /** 各表自增 id */
  seq: { event: number; audit: number; wave: Record<string, number> }
}
