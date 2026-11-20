/**
 * 全局类型的唯一真相源。
 * 三个 slice 都从这里 import —— 这样不会出现循环引用。
 */

export type Role = 'user' | 'assistant' | 'system'

export type MessageStatus = 'complete' | 'streaming' | 'error' | 'aborted'

/** 服务端接受的思考档位。/v1/models 只声明了 max/high/low，但 off 与 none 实测也被接受。 */
export type ReasoningEffort = 'off' | 'none' | 'low' | 'high' | 'max'

/** proxy = 经自己控制的代理转发（默认）；direct = 直连源站（需要源站开 CORS）。 */
export type ConnectionMode = 'proxy' | 'direct'

export type ThemeMode = 'light' | 'dark' | 'system'

export type FontSize = 'sm' | 'md' | 'lg'

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
  /** 客户端估算的 token（服务端不返 usage） */
  tokens?: number
  /** 第几次「重新生成」 */
  version?: number
  model?: string
  effort?: ReasoningEffort
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

export interface Settings {
  mode: ConnectionMode
  /** 直连模式下的源站地址 */
  baseUrl: string
  /** 代理模式下的代理地址（Worker / 本地 Node / 任意反向代理） */
  proxyUrl: string
  /** 运行时填的 key（存 localStorage）；空则回落到构建期注入的内置 key */
  apiKey: string
  model: string
  effort: ReasoningEffort
  temperature: number
  topP: number
  maxTokens: number
  systemPrompt: string
  theme: ThemeMode
  fontSize: FontSize
}

export interface ModelInfo {
  id: string
  owned_by?: string
  context_length?: number
  max_model_len?: number
  supported_reasoning_efforts?: string[]
}

/** 一次请求真正用到的连接参数 */
export interface ApiConfig {
  mode: ConnectionMode
  /** proxy 模式是代理地址，direct 模式是源站地址 */
  baseUrl: string
  /** 实际发出去的 Bearer key（可能为空 —— 代理侧有 key 时就不需要） */
  apiKey: string
}

export type ConnectionStatus = 'idle' | 'testing' | 'ok' | 'error'

export interface ConnectionState {
  status: ConnectionStatus
  latencyMs?: number
  models?: ModelInfo[]
  message?: string
  /** 代理自己报告的：它有没有配置 API key */
  proxyHasKey?: boolean
  at?: number
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
  connection: ConnectionState
  updateSettings: (patch: Partial<Settings>) => void
  resetSettings: () => void
  testConnection: () => Promise<void>
}

export interface ChatSlice {
  conversations: Conversation[]
  activeId: string | null
  /** 正在流式输出的消息 id（null = 没在生成） */
  streamingId: string | null
  newConversation: () => string
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  sendMessage: (text: string) => Promise<void>
  stopGeneration: () => void
  regenerate: (messageId: string) => Promise<void>
  importConversation: (c: Conversation) => void
}

export interface UiSlice {
  sidebarOpen: boolean
  settingsOpen: boolean
  /** 是否贴底（滚到底了） */
  atBottom: boolean
  /** 用户往上滚之后又到的消息数 */
  unread: number
  toasts: Toast[]
  setSidebarOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
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
