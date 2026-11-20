/**
 * 全局类型的唯一真相源。
 * 三个 slice 都从这里 import —— 这样不会出现循环引用。
 */

export type Role = 'user' | 'assistant' | 'system'

export type MessageStatus = 'complete' | 'streaming' | 'error' | 'aborted'

/** 服务端接受的思考档位。/v1/models 只声明了 max/high/low，但 off 与 none 实测也被接受。 */
export type ReasoningEffort = 'off' | 'none' | 'low' | 'high' | 'max'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface Message {
  id: string
  role: Role
  /** 正文 */
  content: string
  /** 思考过程（reasoning_content），与正文分开存、分开渲染 */
  reasoning: string
  createdAt: number
  status: MessageStatus
  error?: { message: string; code?: string }
  /** 思考耗时（ms），面板上显示「已思考 3.2s」 */
  reasoningMs?: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

/**
 * 只有两样东西还归用户管：主题和思考档位。
 * 端点、key、模型、采样参数全部写死在 src/config.ts —— 界面不做通用 API 配置。
 */
export interface Settings {
  theme: ThemeMode
  effort: ReasoningEffort
}

export interface Toast {
  id: string
  at: number
  text: string
  tone: 'info' | 'ok' | 'warn' | 'error'
}

// ── 三个 slice 的接口 ────────────────────────────────────────

export interface SettingsSlice {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
}

export interface ChatSlice {
  conversations: Conversation[]
  activeId: string | null
  /** 正在流式输出的消息 id（null = 没在生成） */
  streamingId: string | null
  newConversation: () => string
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  sendMessage: (text: string) => Promise<void>
  stopGeneration: () => void
  regenerate: (messageId: string) => Promise<void>
}

export interface UiSlice {
  sidebarOpen: boolean
  /** 是否贴底（滚到底了） */
  atBottom: boolean
  /** 用户往上滚之后又到的消息数 */
  unread: number
  toasts: Toast[]
  setSidebarOpen: (v: boolean) => void
  setAtBottom: (v: boolean) => void
  setUnread: (v: number) => void
  pushToast: (t: Omit<Toast, 'id' | 'at'>) => void
  dismissToast: (id: string) => void
}

export type AppState = SettingsSlice & ChatSlice & UiSlice

// ── slice 工厂用的最小签名 ───────────────────────────────────
//   刻意不用 zustand 的 StateCreator<AppState>：那样每个 slice 的动作签名
//   都要引用 AppState，容易绕成循环引用。这里只依赖 AppState 本身，
//   类型提升后没有循环。
export type AppSet = (
  partial: Partial<AppState> | ((s: AppState) => Partial<AppState>),
) => void
export type AppGet = () => AppState