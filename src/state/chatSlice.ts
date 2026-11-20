import type { AppGet, AppSet, ChatSlice, Conversation, Message, Role } from './types'
import { ApiError } from '@/lib/api'
import { describeTruncation, runChat } from '@/lib/chat'

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
    const startedAt = performance.now()
    let reasoningStartedAt: number | null = null

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
        onContent: (chunk) => push(chunk, 'content'),
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
        reasoningMs:
          reasoningStartedAt !== null ? Math.round(reasoningStartedAt - startedAt) : undefined,
        truncated,
      })

      // 标题：取第一条 user 消息的前 24 个字
      const conv = get().conversations.find((c) => c.id === convId)
      if (conv && !conv.title) {
        const first = conv.messages.find((m) => m.role === 'user')
        if (first) {
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === convId ? { ...c, title: first.content.slice(0, 24) } : c,
            ),
          }))
        }
      }
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
      const id = uid()
      const now = Date.now()
      const conv: Conversation = { id, title: '', messages: [], createdAt: now, updatedAt: now }
      set((s) => ({ conversations: [conv, ...s.conversations], activeId: id }))
      return id
    },

    selectConversation: (id) => set({ activeId: id }),

    deleteConversation: (id) =>
      set((s) => {
        const conversations = s.conversations.filter((c) => c.id !== id)
        return {
          conversations,
          activeId: s.activeId === id ? (conversations[0]?.id ?? null) : s.activeId,
        }
      }),



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

      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === convId
            ? {
                ...c,
                title: c.title || trimmed.slice(0, 24),
                updatedAt: now,
                messages: [...c.messages, userMsg],
              }
            : c,
        ),
      }))

      await generate(convId, history)
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

    stopGeneration: () => {
      controller?.abort()
    },
  }
}
