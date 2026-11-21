/**
 * localStorage 读写。
 *
 * 只存四样东西：会话列表、当前会话 id、设置、侧边栏收起状态。
 * 不存 AbortController、连接状态、toast —— 那些是运行时状态，刷新就该没了。
 */

const KEY = 'hippocrenes.chat.v2'

export interface PersistedState {
  conversations: unknown[]
  activeId: string | null
  settings: unknown
  /** 桌面端侧边栏是不是收着的 */
  sidebarCollapsed?: boolean
}

export function loadState<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return { ...fallback, ...parsed } as T
  } catch {
    return fallback
  }
}

export type SaveResult = 'ok' | 'quota'

export function saveState(state: PersistedState): SaveResult {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    return 'ok'
  } catch {
    // QuotaExceededError —— 历史太多或太大
    return 'quota'
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 忽略 */
  }
}
