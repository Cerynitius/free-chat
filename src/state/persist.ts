import type { AppState, Conversation, Settings } from './types'
import { loadState, saveState } from '@/lib/storage'
import { DEFAULT_SETTINGS } from './settingsSlice'

/** 最多留这么多条会话 —— localStorage 配额有限，超了会写失败。 */
const MAX_CONVERSATIONS = 50

/** 写入防抖：流式输出时每个 delta 都会改状态，没必要每次都写盘。 */
const SAVE_DEBOUNCE_MS = 400

interface Persisted {
  conversations: Conversation[]
  activeId: string | null
  settings: Settings
  /** 桌面端侧边栏是不是收着的 */
  sidebarCollapsed?: boolean
}

/**
 * 空会话（一个消息都没发）不值得留在盘上 ——
 * 下次进来直接开一个新的欢迎界面就行，攒一串空壳反而占地方。
 * 置顶的空会话例外 —— 那是用户特意留的。
 */
function keepable(conversations: Conversation[]): Conversation[] {
  return conversations.filter((c) => c.messages.length > 0 || c.pinned)
}

export function hydrate(store: {
  getState: () => AppState
  setState: (partial: Partial<AppState>) => void
  subscribe: (listener: (state: AppState, prev: AppState) => void) => () => void
}): void {
  const saved = loadState<Persisted>({
    conversations: [],
    activeId: null,
    settings: DEFAULT_SETTINGS,
  })

  store.setState({
    conversations: keepable(saved.conversations ?? []),
    activeId: saved.activeId ?? null,
    settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
    sidebarCollapsed: saved.sidebarCollapsed ?? false,
  })

  // 每次进来都是「欢迎界面 + 一个新会话」——
  // 上次聊到哪儿不该把人硬拽回去，想找随时在侧边栏里点。
  store.getState().newConversation()

  let timer: number | null = null
  let warned = false

  const persist = (): void => {
    const s = store.getState()
    // 只留最近 N 条，超出的从最旧的开始丢
    const conversations = keepable(s.conversations).slice(0, MAX_CONVERSATIONS)
    // activeId 指向的会话要是没留下，就别存了 —— 免得下次进来指向一个不存在的会话
    const activeId = conversations.some((c) => c.id === s.activeId) ? s.activeId : null
    const result = saveState({
      conversations,
      activeId,
      settings: s.settings,
      sidebarCollapsed: s.sidebarCollapsed,
    })
    if (result === 'quota' && !warned) {
      warned = true
      store.getState().pushToast({
        text: '本地存储空间不足，最早的会话可能没能保存下来。',
        tone: 'warn',
      })
    }
  }

  store.subscribe((s, prev) => {
    if (
      s.conversations === prev.conversations &&
      s.activeId === prev.activeId &&
      s.settings === prev.settings &&
      s.sidebarCollapsed === prev.sidebarCollapsed
    ) {
      return
    }
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      persist()
    }, SAVE_DEBOUNCE_MS)
  })
}
