import type { AppState, Conversation, Settings } from './types'
import { DEFAULT_SETTINGS } from './settingsSlice'
import { getConversations, loadConversations, writeConversations } from '@/lib/db'
import { loadPrefs, readLegacy, removeLegacy, savePrefs } from '@/lib/storage'

/**
 * 本地持久化。
 *
 *   设置 / 侧边栏状态 → localStorage（同步读，第一帧就有主题）
 *   会话             → IndexedDB，一条会话一条记录，只写改过的那几条
 *
 * 同一个浏览器开了几个标签页：每次写完用 BroadcastChannel 告诉别的标签页
 * 「哪几条变了」，它们只重读那几条 —— 不会出现两个标签页互相覆盖整份历史。
 */

/** 写入节流：流式输出时会话每 80 ms 变一次，攒一攒再写；但最多拖这么久 */
const SAVE_DEBOUNCE_MS = 400
const SAVE_MAX_WAIT_MS = 2000

type Store = {
  getState: () => AppState
  setState: (partial: Partial<AppState>) => void
  subscribe: (listener: (state: AppState, prev: AppState) => void) => () => void
}

type SyncMessage = { type: 'changed'; ids: string[]; deleted: string[] }

/** 空会话（一个消息都没发）不上盘；置顶的空会话例外 —— 那是用户特意留的 */
function keepable(c: Conversation): boolean {
  return c.messages.length > 0 || c.pinned
}

/** 中断在流式输出中途的消息，重开页面时不能还显示「正在生成」 */
function settle(c: Conversation): Conversation {
  if (!c.messages.some((m) => m.status === 'streaming' || m.retry)) return c
  return {
    ...c,
    messages: c.messages.map((m) =>
      m.status === 'streaming' || m.retry
        ? { ...m, status: 'aborted' as const, retry: undefined, truncated: m.truncated ?? { kind: 'stream' as const } }
        : m,
    ),
  }
}

let channel: BroadcastChannel | null = null
/** 从别的标签页同步过来的会话对象 —— 订阅者看到它们不再写回去，免得来回弹 */
const fromRemote = new WeakSet<Conversation>()
let flushNow: (() => Promise<void>) | null = null

/** 立刻把没写的改动落盘（导入、清空之前用） */
export async function flushPending(): Promise<void> {
  await flushNow?.()
}

export function hydrate(store: Store): void {
  // ── 1. 同步部分：设置（主题、字号要在第一帧就对） ──
  const legacy = readLegacy()
  const prefs = loadPrefs<{ settings?: Partial<Settings>; sidebarCollapsed?: boolean }>()
  store.setState({
    settings: { ...DEFAULT_SETTINGS, ...(legacy?.settings ?? {}), ...(prefs?.settings ?? {}) },
    sidebarCollapsed: prefs?.sidebarCollapsed ?? legacy?.sidebarCollapsed ?? false,
  })

  // 每次进来都是「欢迎界面 + 一个新会话」——上次聊到哪儿不该把人硬拽回去
  store.getState().newConversation()

  // ── 2. 异步部分：会话从 IndexedDB 读出来 ──
  const dirty = new Set<string>()
  const deleted = new Set<string>()
  let ready = false
  let timer: number | null = null
  let firstDirtyAt = 0
  let warned = false

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    firstDirtyAt = 0
    if (!ready || (!dirty.size && !deleted.size)) return
    const byId = new Map(store.getState().conversations.map((c) => [c.id, c]))
    const put: Conversation[] = []
    const del: string[] = [...deleted]
    for (const id of dirty) {
      const c = byId.get(id)
      if (!c) del.push(id)
      else if (keepable(c)) put.push(c)
      else del.push(id) // 被清空的会话（比如改写了唯一的一条）
    }
    dirty.clear()
    deleted.clear()
    try {
      await writeConversations(put, del)
      channel?.postMessage({ type: 'changed', ids: put.map((c) => c.id), deleted: del } satisfies SyncMessage)
    } catch (err) {
      // 写失败（多半是空间满了）：这批改动放回去，下次再试
      for (const c of put) dirty.add(c.id)
      for (const id of del) deleted.add(id)
      if (!warned) {
        warned = true
        store.getState().pushToast({
          text: `本地存储写入失败：${err instanceof Error ? err.message : String(err)}`,
          tone: 'warn',
        })
      }
    }
  }
  flushNow = flush

  const schedule = (): void => {
    const now = Date.now()
    if (!firstDirtyAt) firstDirtyAt = now
    if (timer !== null) window.clearTimeout(timer)
    const wait = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, firstDirtyAt + SAVE_MAX_WAIT_MS - now))
    timer = window.setTimeout(() => void flush(), wait)
  }

  store.subscribe((s, prev) => {
    if (s.settings !== prev.settings || s.sidebarCollapsed !== prev.sidebarCollapsed) {
      savePrefs({ settings: s.settings, sidebarCollapsed: s.sidebarCollapsed })
    }
    if (s.conversations === prev.conversations) return
    const before = new Map(prev.conversations.map((c) => [c.id, c]))
    for (const c of s.conversations) {
      if (before.get(c.id) !== c && !fromRemote.has(c)) dirty.add(c.id)
      before.delete(c.id)
    }
    for (const id of before.keys()) {
      dirty.delete(id)
      deleted.add(id)
    }
    if (dirty.size || deleted.size) schedule()
  })

  // 关页面 / 切到后台：没写的赶紧写（IndexedDB 事务在 pagehide 里多半来得及提交）
  const onHide = (): void => void flush()
  window.addEventListener('pagehide', onHide)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide()
  })

  void (async () => {
    let stored: Conversation[] = []
    try {
      stored = await loadConversations()
      // 老版本把会话放在 localStorage 里 —— 第一次用新版本时搬过来
      if (!stored.length && legacy?.conversations?.length) {
        const moved = (legacy.conversations as Conversation[]).filter(keepable)
        await writeConversations(moved, [])
        stored = moved
      }
      if (legacy) removeLegacy()
    } catch (err) {
      store.getState().pushToast({
        text: `读不了本地历史：${err instanceof Error ? err.message : String(err)}。这次的会话不会被保存。`,
        tone: 'error',
      })
      store.setState({ historyLoaded: true })
      return
    }
    const s = store.getState()
    const local = new Set(s.conversations.map((c) => c.id))
    const loaded = stored.filter((c) => !local.has(c.id)).map(settle)
    for (const c of loaded) fromRemote.add(c)
    store.setState({ conversations: [...s.conversations, ...loaded], historyLoaded: true })
    ready = true
    if (dirty.size || deleted.size) schedule()

    // ── 3. 多标签页同步 ──
    if (typeof BroadcastChannel === 'undefined') return
    channel = new BroadcastChannel('free-chat')
    channel.onmessage = async (ev: MessageEvent<SyncMessage>) => {
      const msg = ev.data
      if (msg?.type !== 'changed') return
      const cur = store.getState()
      // 正在本页生成的那条会话以本页为准 —— 别被别的标签页的旧版本盖掉
      const busy = new Set(
        cur.conversations.filter((c) => c.messages.some((m) => m.id === cur.streamingId)).map((c) => c.id),
      )
      const fresh = (await getConversations(msg.ids.filter((id) => !busy.has(id)))).map(settle)
      for (const c of fresh) fromRemote.add(c)
      const byId = new Map(fresh.map((c) => [c.id, c]))
      const gone = new Set(msg.deleted.filter((id) => !busy.has(id)))
      const now = store.getState()
      const kept = now.conversations
        .filter((c) => !gone.has(c.id))
        .map((c) => {
          const f = byId.get(c.id)
          if (!f) return c
          byId.delete(c.id)
          // 本页还有没写的改动，并且比对方新 ⇒ 留本页的
          return dirty.has(c.id) && c.updatedAt > f.updatedAt ? c : f
        })
      const conversations = [...kept, ...byId.values()]
      const patch: Partial<AppState> = { conversations }
      if (now.activeId && gone.has(now.activeId)) {
        patch.activeId = conversations[0]?.id ?? null
      }
      store.setState(patch)
      if (!store.getState().activeId) store.getState().newConversation()
    }
  })()
}
