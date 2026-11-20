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
    conversations: saved.conversations ?? [],
    activeId: saved.activeId ?? null,
    settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
  })

  let timer: number | null = null
  let warned = false

  const persist = (): void => {
    const s = store.getState()
    // 只留最近 N 条，超出的从最旧的开始丢
    const conversations = s.conversations.slice(0, MAX_CONVERSATIONS)
    const result = saveState({
      conversations,
      activeId: s.activeId,
      settings: s.settings,
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
    if (s.conversations === prev.conversations && s.activeId === prev.activeId && s.settings === prev.settings) {
      return
    }
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      persist()
    }, SAVE_DEBOUNCE_MS)
  })
}
