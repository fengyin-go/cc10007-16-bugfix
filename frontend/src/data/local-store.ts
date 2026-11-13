import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'data-layer-studio:entries'
// 数据结构版本：种子口径变化（如转换编排改为真实依赖链）时 +1，强制旧缓存迁移，避免新逻辑读到旧数据。
const STORAGE_VERSION = 2
const VERSION_KEY = 'data-layer-studio:version'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isOutdated(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false
  }
  return window.localStorage.getItem(VERSION_KEY) !== String(STORAGE_VERSION)
}

function stampVersion(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  // 旧版本缓存直接整体迁移到新种子，保证字段口径与领域引擎一致。
  if (isOutdated()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    stampVersion()
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    stampVersion()
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    stampVersion()
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    stampVersion()
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
