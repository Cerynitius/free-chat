import type { AppGet, AppSet, ChatSlice, Conversation, Message, Role } from './types'
import { ApiError } from '@/lib/api'
import { describeTruncation, fetchTitle, runChat } from '@/lib/chat'
import { cleanTitle, deriveTitle } from '@/lib/title'

function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** 流式缓冲的刷新间隔（毫秒）—— 每个 delta 都 set() 会让整棵消息树重渲染。 */
const FLUSH_MS = 80

export const chatSlice = (set: AppSet, get: AppGet): ChatSlice => {
  /** 正在跑的请求 —— 用来支持「停止生成」 */
  let controller: AbortController | null = null

  /**
   * 流式缓冲：分片先攒在这里，每 FLUSH_MS 刷一次进 store。
   * 状态更新频率从「每个 token 一次」降到「每秒 12 次」。
   */
  const buffers = new Map<string, { content: string; reasoning: string }>()
  let timer: number | null = null

  const flush = (convId: string, msgId: string): void => {
    const buf = buffers.get(msgId)
    if (!buf) return
    buffers.delete(msgId)
    if (!buf.content && !buf.reasoning) return
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId
          ? {
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.map((m) =>
                m.id === msgId
                  ? {
                      ...m,
                      content: m.content + buf.content,
                      reasoning: m.reasoning + buf.reasoning,
                    }
                  : m,
              ),
            }
          : c,
      ),
    }))
  }

  const scheduleFlush = (convId: string): void => {
    if (timer !== null) return
    timer = window.setTimeout(() => {
      timer = null
      for (const id of [...buffers.keys()]) flush(convId, id)
    }, FLUSH_MS)
  }

  const patchMessage = (
    convId: string,
    msgId: string,
    patch: Partial<Message>,
  ): void => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId
          ? {
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
            }
          : c,
      ),
    }))
  }

  /**
   * 自动命名：正文跑完了，让模型起一个更像样的名字。
   *
   * 放在正文**之后**是有意的 —— 起名请求跟正文抢上游的话，
   * 回答本身会被拖慢。名字晚一步出现没关系，界面上早就有本地兜底名。
   */
  const refineTitle = async (convId: string, source: string): Promise<void> => {
    const raw = await fetchTitle(source)
    if (!raw) return
    const title = cleanTitle(raw)
    if (!title) return
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId && !c.titleLocked ? { ...c, title } : c,
      ),
    }))
  }

  /**
   * 发起一次生成。history 是「已经存在的消息」，
   * 助手占位消息由本函数自己插入。
   */
  const generate = async (convId: string, history: Message[]): Promise<void> => {
    const now = Date.now()
    const asstId = uid()
    const placeholder: Message = {
      id: asstId,
      role: 'assistant',
      content: '',
      reasoning: '',
      createdAt: now,
      status: 'streaming',
    }

    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, updatedAt: now, messages: [...c.messages, placeholder] } : c,
      ),
      streamingId: asstId,
    }))

    const messages = history
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
      .map((m) => ({ role: m.role as Role, content: m.content }))

    const ctrl = new AbortController()
    controller = ctrl

    const effort = get().settings.effort
    /** 第一个思考 token 落地的时间 —— 思考从这里开始 */
    let reasoningStartedAt: number | null = null
    /** 第一个正文 token 落地的时间 —— 思考到这里结束 */
    let reasoningEndedAt: number | null = null

    const push = (chunk: string, field: 'content' | 'reasoning'): void => {
      const buf = buffers.get(asstId) ?? { content: '', reasoning: '' }
      buf[field] += chunk
      buffers.set(asstId, buf)
      scheduleFlush(convId)
    }

    try {
      const outcome = await runChat({
        messages,
        effort,
        signal: ctrl.signal,
        onReasoning: (chunk) => {
          if (reasoningStartedAt === null) reasoningStartedAt = performance.now()
          push(chunk, 'reasoning')
        },
        onContent: (chunk) => {
          // 第一个正文 token ⇒ 思考结束，耗时当场定下来，
          // 面板这时就能报「已思考 X 秒」，不用等整段生成跑完。
          if (reasoningStartedAt !== null && reasoningEndedAt === null) {
            reasoningEndedAt = performance.now()
            patchMessage(convId, asstId, {
              reasoningMs: Math.round(reasoningEndedAt - reasoningStartedAt),
            })
          }
          push(chunk, 'content')
        },
      })

      // 收尾：把残余缓冲刷进 store，再定状态
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      flush(convId, asstId)

      // 被截断也是一种「完成」—— 但必须留个记号，
      // 否则半个回答看起来和完整回答一模一样，没人知道发生过什么。
      const truncated = describeTruncation(outcome)

      patchMessage(convId, asstId, {
        status: 'complete',
        // 思考耗时：没等到正文 token（比如思考完就被截断）就取到流收尾那一刻
        reasoningMs:
          reasoningStartedAt !== null
            ? Math.round((reasoningEndedAt ?? performance.now()) - reasoningStartedAt)
            : undefined,
        truncated,
      })
    } catch (err) {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      flush(convId, asstId)

      // 「停止生成」有两种表现：请求还没发出去时是 ApiError('已停止')，
      // 流式途中被掐时是 DOMException(AbortError) —— 两种都得认，
      // 否则手动停止会被显示成「请求失败」。
      const aborted =
        (err instanceof ApiError && err.kind === 'abort') || (err as Error)?.name === 'AbortError'
      const message = err instanceof Error ? err.message : String(err)
      patchMessage(convId, asstId, {
        status: aborted ? 'aborted' : 'error',
        error: aborted ? undefined : { message },
        // 半路被打断也算想过：报出到这一刻为止的耗时
        reasoningMs:
          reasoningStartedAt !== null
            ? Math.round((reasoningEndedAt ?? performance.now()) - reasoningStartedAt)
            : undefined,
      })
    } finally {
      controller = null
      set({ streamingId: null })
    }
  }

  return {
    conversations: [],
    activeId: null,
    streamingId: null,

    newConversation: () => {
      const s = get()
      const cur = s.conversations.find((c) => c.id === s.activeId)
      // 当前这个还是空的 ⇒ 直接用它，别堆一串空会话
      if (cur && cur.messages.length === 0 && !cur.title) return cur.id

      const id = uid()
      const now = Date.now()
      const conv: Conversation = {
        id,
        title: '',
        pinned: false,
        messages: [],
        createdAt: now,
        updatedAt: now,
      }
      set((st) => ({ conversations: [conv, ...st.conversations], activeId: id }))
      return id
    },

    selectConversation: (id) => set({ activeId: id }),

    deleteConversation: (id) =>
      set((s) => {
        const conversations = s.conversations.filter((c) => c.id !== id)
        if (s.activeId !== id) return { conversations }
        if (conversations.length > 0) return { conversations, activeId: conversations[0].id }
        // 一个都不剩 ⇒ 立刻开一个新的空会话（别把用户晾在空白页上）
        const now = Date.now()
        const fresh: Conversation = {
          id: uid(),
          title: '',
          pinned: false,
          messages: [],
          createdAt: now,
          updatedAt: now,
        }
        return { conversations: [fresh], activeId: fresh.id }
      }),

    renameConversation: (id, title) =>
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id
            ? // 手动改过的标题，自动命名就不许再覆盖了
              { ...c, title: cleanTitle(title), titleLocked: true }
            : c,
        ),
      })),

    togglePin: (id) =>
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, pinned: !c.pinned } : c,
        ),
      })),

    sendMessage: async (text) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (get().streamingId) return

      let convId = get().activeId
      if (!convId || !get().conversations.some((c) => c.id === convId)) {
        convId = get().newConversation()
      }

      const now = Date.now()
      const userMsg: Message = {
        id: uid(),
        role: 'user',
        content: trimmed,
        reasoning: '',
        createdAt: now,
        status: 'complete',
      }

      const conv = get().conversations.find((c) => c.id === convId)
      const history = conv ? [...conv.messages, userMsg] : [userMsg]
      // 这是不是这个会话的第一句话？—— 是的话才有「自动命名」这回事
      const isFirst = !conv || conv.messages.length === 0

      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === convId
            ? {
                ...c,
                // 自动命名：先本地抠一个顶上（界面上永远有名字），模型版随后覆盖
                title: c.title || deriveTitle(trimmed),
                updatedAt: now,
                messages: [...c.messages, userMsg],
              }
            : c,
        ),
      }))

      await generate(convId, history)

      // 正文跑完了，再让模型起个更像样的名字（用户自己改过的不动）
      if (isFirst) {
        const after = get().conversations.find((c) => c.id === convId)
        if (after && !after.titleLocked) void refineTitle(convId, trimmed)
      }
    },

    /**
     * 重新生成：删掉那条助手消息（及其后的内容），用同样的历史再跑一遍。
     */
    regenerate: async (messageId) => {
      const s = get()
      if (s.streamingId) return
      const conv = s.conversations.find((c) => c.messages.some((m) => m.id === messageId))
      if (!conv) return

      const idx = conv.messages.findIndex((m) => m.id === messageId)
      if (idx < 0) return

      const keep = conv.messages.slice(0, idx)
      set((st) => ({
        conversations: st.conversations.map((c) => (c.id === conv.id ? { ...c, messages: keep } : c)),
      }))

      await generate(conv.id, keep)
    },

    /**
     * 改写一条用户消息。
     *
     * 「重写」的意思是：这一轮之后的东西全部作废 ——
     * 旧的问题、旧的回答、旧的后续，全删掉，用新问题重新问一遍。
     */
    editMessage: async (messageId, text) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (get().streamingId) return

      const conv = get().conversations.find((c) => c.messages.some((m) => m.id === messageId))
      if (!conv) return
      const idx = conv.messages.findIndex((m) => m.id === messageId)
      if (idx < 0) return
      if (conv.messages[idx].role !== 'user') return

      const now = Date.now()
      const edited: Message = { ...conv.messages[idx], content: trimmed, createdAt: now }
      // 只留这一轮之前的消息 + 改过的那条 —— 后面的全部作废
      const history = [...conv.messages.slice(0, idx), edited]
      const isFirst = idx === 0

      set((st) => ({
        conversations: st.conversations.map((c) =>
          c.id === conv.id
            ? {
                ...c,
                messages: history,
                updatedAt: now,
                // 改的是第一条问题 ⇒ 名字也跟着重抠一遍
                title: isFirst && !c.titleLocked ? deriveTitle(trimmed) : c.title,
              }
            : c,
        ),
      }))

      await generate(conv.id, history)

      if (isFirst) {
        const after = get().conversations.find((c) => c.id === conv.id)
        if (after && !after.titleLocked) void refineTitle(conv.id, trimmed)
      }
    },

    stopGeneration: () => {
      controller?.abort()
    },
  }
}
