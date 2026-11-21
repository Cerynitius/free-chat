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

/**
 * 一次工具调用的记录。
 *
 * 挂在助手消息上 —— 界面把它画成一张卡片，
 * 同时也是回给上游的凭据（tool_calls + role:"tool" 两条消息）。
 */
export interface ToolCallRecord {
  /** 上游给的调用 id —— 回结果时要用它对上号 */
  id: string
  /** 工具名 */
  name: string
  /** 参数原文（模型给的是 JSON 字符串） */
  args: string
  /** 跑到哪儿了 */
  status: 'running' | 'done' | 'error'
  /** 回给模型的结果 */
  result?: string
  /** 一句话摘要，界面上显示用 */
  summary?: string
  /** 工具自己报的错 */
  error?: string
}

/** 发给上游的工具调用（协议里的形状） */
export interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/**
 * 发给上游的消息。
 *
 * 比 Role 宽 —— 工具那一轮里，助手消息要带 tool_calls，
 * 工具结果是一条 role:"tool" 的消息。
 */
export type OutgoingMessage =
  | { role: 'user' | 'system'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

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
  /** 这一轮用过的工具 */
  tools?: ToolCallRecord[]
  /** 工具这一套出了状况时的说明（比如上游不接工具调用了） */
  toolsNote?: string
  /**
   * 这条消息带的是哪些附件（文件名）。
   *
   * 界面上不显示（附件有自己的位置），但**发给上游时要带上** ——
   * 不然模型不知道有哪些文件可读，只能反过来问用户文件名。
   */
  attachments?: string[]
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
 * 归用户管的只有界面和习惯上的东西（存在本地浏览器里）。
 * 端点、key、模型、采样参数全部写死在 src/config.ts —— 界面不做通用 API 配置。
 */
export type FontSize = 'sm' | 'md' | 'lg'

/** 界面风格：网页对话（暖色纸面、居中对话）或终端（等宽、命令行式） */
export type UiStyle = 'web' | 'terminal'

/** 发送键：Enter 发送（Shift+Enter 换行），或 Ctrl/⌘+Enter 发送（Enter 换行） */
export type SendKey = 'enter' | 'mod-enter'

export interface Settings {
  theme: ThemeMode
  uiStyle: UiStyle
  effort: ReasoningEffort
  /** 工具（搜索 / 抓页面 / 读文件 / 认字）要不要开着 */
  tools: boolean
  /** 正文字号 */
  fontSize: FontSize
  sendKey: SendKey
  /** 自定义指令：每次对话都附在系统提示后面（比如「回答用简体中文、先给结论」） */
  instructions: string
  /** 导出 / 复制时带不带思考过程 */
  exportReasoning: boolean
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
  sendMessage: (text: string, attachments?: string[]) => Promise<void>
  stopGeneration: () => void
  regenerate: (messageId: string) => Promise<void>
  /**
   * 改写一条用户消息：删掉它和它之后的全部对话，
   * 用新内容替换，然后让模型重新回答这一轮。
   */
  editMessage: (messageId: string, text: string, attachments?: string[]) => Promise<void>
  /** 导入会话（备份文件）：同 id 的留更新的那份。返回新增 / 更新的条数 */
  importConversations: (list: Conversation[]) => { added: number; updated: number }
  /** 删掉全部会话（正在生成的那条除外） */
  clearConversations: () => void
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
  /** 本地历史读完了没有（IndexedDB 是异步的） */
  historyLoaded: boolean
  /** 设置面板开着没有 */
  settingsOpen: boolean
  /** 侧边栏搜索框要不要拿焦点（Ctrl+K 递增这个数） */
  searchFocusTick: number
  setSettingsOpen: (v: boolean) => void
  focusSearch: () => void
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