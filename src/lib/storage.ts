/**
 * localStorage 里的小东西：设置、侧边栏状态、草稿。
 *
 * 会话本身在 IndexedDB（见 lib/db.ts）。这里的每一次读写都包在 try 里 ——
 * 隐私窗口、禁用了站点数据的浏览器会直接抛异常，界面不能因此起不来。
 */

const PREFS_KEY = 'freechat.prefs.v1'
const DRAFTS_KEY = 'freechat.drafts.v1'
/** 老版本把一切都塞在这一个键里 —— 第一次启动新版本时读出来搬走 */
const LEGACY_KEY = 'hippocrenes.chat.v2'

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* 忽略 */
  }
}

export function loadPrefs<T>(): T | null {
  return read<T>(PREFS_KEY)
}

export function savePrefs(value: unknown): void {
  write(PREFS_KEY, value)
}

export interface LegacyState {
  conversations?: unknown[]
  activeId?: string | null
  settings?: Record<string, unknown>
  sidebarCollapsed?: boolean
}

export function readLegacy(): LegacyState | null {
  return read<LegacyState>(LEGACY_KEY)
}

export function removeLegacy(): void {
  remove(LEGACY_KEY)
}

// ── 草稿：没发出去的话按会话存着，刷新、切走再回来都还在 ──

/** 草稿最多留这么多条（按最近修改），免得一直堆 */
const MAX_DRAFTS = 100

type Drafts = Record<string, { text: string; at: number }>

export function loadDraft(convId: string): string {
  return read<Drafts>(DRAFTS_KEY)?.[convId]?.text ?? ''
}

export function saveDraft(convId: string, text: string): void {
  const drafts = read<Drafts>(DRAFTS_KEY) ?? {}
  if (text.trim()) drafts[convId] = { text, at: Date.now() }
  else delete drafts[convId]
  const keys = Object.keys(drafts)
  if (keys.length > MAX_DRAFTS) {
    keys
      .sort((a, b) => drafts[a].at - drafts[b].at)
      .slice(0, keys.length - MAX_DRAFTS)
      .forEach((k) => delete drafts[k])
  }
  write(DRAFTS_KEY, drafts)
}

export function clearDrafts(): void {
  remove(DRAFTS_KEY)
}
