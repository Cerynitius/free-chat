/**
 * 全局类型的唯一真相源。
 * 三个 slice 都从这里 import —— 这样不会出现循环引用。
 */

export type Role = 'user' | 'assistant' | 'system'

export type MessageStatus = 'complete' | 'streaming' | 'error' | 'aborted'

/**
 * 内容被截断的来由。
 *
 * 这一栏存在的理由：被截断的回答**看起来**和正常完成的一模一样 ——
 * 有内容、没报错、状态还是「完成」。不说出来的话，排查的人根本无从下手。
 */
export type TruncationKind =
  /** 撞到 max_tokens 上限。思考和正文共用这一个预算，想太久正文就没了 */
  | 'length'
  /** 流提前断了（连接被掐）—— 内容不完整 */
  | 'stream'
  /** 上游的过滤器把内容截了 */
  | 'content-filter'

export interface Truncation {
  kind: TruncationKind
  /** 上游给的结束原因原文 */
  finishReason?: string | null
}

/** 服务端接受的思考档位。/v1/models 只声明了 max/high/low，但 off 与 none 实测也被接受。 */
export type ReasoningEffort = 'off' | 'none' | 'low' | 'high' | 'max'

export type ThemeMode = 'light' | 'dark' | 'system'

/**
 * 上游满了，正在排队重试 —— 这不是错误，是等待。
 *
 * 这个上游同时只接一个请求（服务商最大并行数 1），第二个会被 429 挡回来。
 * 挡回来不等于失败，等一分钟再来一次就是 —— 但排队的次数有上限，
 * 排不上就明说，不能让一条消息永远挂着。
 */
export interface RetryNotice {
  /** 第几次重试（1 = 第一次） */
  attempt: number
  /** 最多排几次 */
  max: number
  /** 什么时候重试（时间戳） */
  at: number
  /** 一句话说明 —— 人话，不是上游原话 */
  message: string
}

export interface Message {
  id: string
  role: Role
  /** 正文 */
  content: string
  /** 思考过程（reasoning_content），与正文分开存、分开渲染 */
  reasoning: string
  createdAt: number
  status: MessageStatus
  error?: { message: string; code?: string; detail?: string }
  /** 正在排队重试 —— 有这一栏就不是失败，是等着 */
  retry?: RetryNotice
  /** 内容被截断时的说明 —— 没有这一栏，被截断的回答会被误当成正常完成 */
  truncated?: Truncation
  /** 思考耗时（ms）：从第一个思考 token 到第一个正文 token，面板上显示「已思考 3.2 秒」 */
  reasoningMs?: number
}

export interface Conversation {
  id: string
  title: string
  /** 置顶 —— 置顶的会话排在列表最上面，不跟着日期走 */
  pinned: boolean
  /**
   * 标题是不是用户自己起的。
   *
   * 自动命名只在标题还「没人管」的时候出手 —— 用户手动改过就不许再被覆盖。
   */
  titleLocked?: boolean
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
  /** 改会话名 —— 空名字等于「未命名会话」 */
  renameConversation: (id: string, title: string) => void
  /** 置顶 / 取消置顶 */
  togglePin: (id: string) => void
  sendMessage: (text: string) => Promise<void>
  stopGeneration: () => void
  regenerate: (messageId: string) => Promise<void>
  /**
   * 改写一条用户消息：删掉它和它之后的全部对话，
   * 用新内容替换，然后让模型重新回答这一轮。
   */
  editMessage: (messageId: string, text: string) => Promise<void>
}

export interface UiSlice {
  sidebarOpen: boolean
  /** 桌面端侧边栏收起（手机上不管这个） */
  sidebarCollapsed: boolean
  /** 是否贴底（滚到底了） */
  atBottom: boolean
  /** 用户往上滚之后又到的消息数 */
  unread: number
  toasts: Toast[]
  setSidebarOpen: (v: boolean) => void
  setSidebarCollapsed: (v: boolean) => void
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