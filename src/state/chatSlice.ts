import type {
  AppGet,
  AppSet,
  ChatSlice,
  Conversation,
  Message,
  OutgoingMessage,
  ToolCallRecord,
} from './types'
import { ApiError, isConcurrencyError } from '@/lib/api'
import { describeTruncation, fetchTitle, runChat, type ChatOutcome } from '@/lib/chat'
import { cleanTitle, deriveTitle } from '@/lib/title'
import { runTool, toolDefinitions } from '@/lib/tools'

function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** 流式缓冲的刷新间隔（毫秒）—— 每个 delta 都 set() 会让整棵消息树重渲染。 */
const FLUSH_MS = 80

/**
 * 一轮回答里最多让模型调几遍工具。
 *
 * 模型可以连着调工具（搜完再抓那个页面），但总得有个头 ——
 * 不然它能一直转下去，用户只能干看着。
 */
const MAX_TOOL_ROUNDS = 5

/**
 * 把 store 里的消息翻成发给上游的格式。
 *
 * 工具那一轮在上游眼里是**两条**消息：一条带 tool_calls 的助手消息，
 * 外加每调用一条 role:"tool" 的结果消息。少一条上游就会挑理。
 *
 * 用户消息如果带附件，要**把附件名捎给模型** —— 不然它不知道有哪些文件可读，
 * 只能反过来问用户「那文件叫什么名字」。
 */
function toOutgoing(messages: Message[]): OutgoingMessage[] {
  const out: OutgoingMessage[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      if (!m.content.trim()) continue
      const names = m.attachments ?? []
      const note = names.length
        ? `\n\n（这条消息带了附件：${names.join('、')}。用 read_file 读文档、ocr 认图片，path 就填这些文件名。）`
        : ''
      out.push({ role: 'user', content: m.content + note })
      continue
    }
    if (m.role !== 'assistant') continue

    // 这一轮用过的工具 —— 跑完了、有结果的才算数
    const calls = (m.tools ?? []).filter((t) => t.status !== 'running' && t.result !== undefined)
    if (calls.length) {
      out.push({
        role: 'assistant',
        content: m.content,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: c.args },
        })),
      })
      for (const c of calls) {
        out.push({ role: 'tool', tool_call_id: c.id, content: c.result ?? '' })
      }
      continue
    }

    if (m.content.trim()) out.push({ role: 'assistant', content: m.content })
  }
  return out
}

/**
 * 上游同时只接一个请求（服务商最大并行数 1）。
 * 第二个请求会被 429 挡回来 —— 那不是失败，是排队，等一分钟再来。
 *
 * 排队有次数上限：排了这么久还没轮到，就明说排不上，
 * 别让一条消息永远挂在「即将重试」上。
 */
const CONCURRENCY_WAIT_MS = 60_000
const CONCURRENCY_MAX_ATTEMPTS = 5

/** 等一会儿（或者等到用户喊停） */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const done = (): void => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = window.setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

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
   *
   * 这一轮可能来回复数遍：模型要调工具 → 工具跑完 → 把结果喂回去 →
   * 模型接着答。每跑一遍，模型的正文都续写进**同一条**助手消息 ——
   * 界面上看起来就是一段连续的回答。
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

    /** 发给上游的消息 —— 每跑完一轮工具就往后接一段 */
    let outgoing: OutgoingMessage[] = toOutgoing(history)
    /** 这一遍请求里模型说出口的字 */
    let turnContent = ''
    /** 这一轮用过的工具（界面上画卡片，回给上游也要用） */
    const toolRecords: ToolCallRecord[] = []
    /** 工具还能不能用 —— 上游要是哪天不接 tools，就降级成纯聊天 */
    let useTools = get().settings.tools

    const ctrl = new AbortController()
    controller = ctrl

    const effort = get().settings.effort
    /** 思考从这一刻开始 */
    let reasoningStartedAt: number | null = null
    /** 累计的思考耗时 —— 工具那一轮会再想一次，累加起来 */
    let reasoningMs = 0

    const push = (chunk: string, field: 'content' | 'reasoning'): void => {
      const buf = buffers.get(asstId) ?? { content: '', reasoning: '' }
      buf[field] += chunk
      buffers.set(asstId, buf)
      scheduleFlush(convId)
    }

    /**
     * 跑一次生成 —— 上游满了就在这里排队重试。
     *
     * 「满了」不是失败：同一个 IP 同时只跑一个请求，第二个被 429 挡回来。
     * 等一分钟再来一次就行，别把这事变成一条红色报错。
     */
    const runWithQueue = async (): Promise<ChatOutcome> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await runChat({
            messages: outgoing,
            effort,
            signal: ctrl.signal,
            ...(useTools ? { tools: toolDefinitions() } : {}),
            onReasoning: (chunk) => {
              if (reasoningStartedAt === null) reasoningStartedAt = performance.now()
              push(chunk, 'reasoning')
            },
            onContent: (chunk) => {
              // 第一个正文 token ⇒ 这一段思考结束，耗时当场定下来，
              // 面板这时就能报「已思考 X 秒」，不用等整段生成跑完。
              if (reasoningStartedAt !== null) {
                reasoningMs += Math.round(performance.now() - reasoningStartedAt)
                reasoningStartedAt = null
                patchMessage(convId, asstId, { reasoningMs })
              }
              turnContent += chunk
              push(chunk, 'content')
            },
          })
        } catch (err) {
          if (!isConcurrencyError(err)) throw err

          // 排了这么久还没轮到 —— 把话说清楚：它不会再自己重试了
          if (attempt >= CONCURRENCY_MAX_ATTEMPTS) {
            const base = err instanceof Error ? err.message : String(err)
            throw new ApiError(
              `${base}（已经自动排了 ${CONCURRENCY_MAX_ATTEMPTS} 次还是没轮到，不会再自动重试了 —— 过一会儿自己再发一次，或者点「重新生成」。）`,
              'http',
              429,
              'concurrency_limit',
              err instanceof ApiError ? err.detail : undefined,
            )
          }

          // 把「正在等」摆到界面上 —— 别让人对着一个空转圈发呆
          patchMessage(convId, asstId, {
            status: 'streaming',
            retry: {
              attempt: attempt + 1,
              max: CONCURRENCY_MAX_ATTEMPTS,
              at: Date.now() + CONCURRENCY_WAIT_MS,
              message: err instanceof Error ? err.message : String(err),
            },
          })
          flush(convId, asstId)
          await wait(CONCURRENCY_WAIT_MS, ctrl.signal)
          if (ctrl.signal.aborted) throw err
          patchMessage(convId, asstId, { retry: undefined })
        }
      }
    }

    try {
      let outcome: ChatOutcome = { finishReason: null, endedCleanly: false }
      let round = 0
      /** 工具轮次用完了 —— 再要工具也不给了，让模型自己收尾 */
      let toolLimitHit = false

      while (true) {
        try {
          outcome = await runWithQueue()
        } catch (err) {
          // 上游不接 tools 了 —— 去掉工具重发一次，别让整轮失败
          if (useTools && err instanceof ApiError && err.status === 400) {
            useTools = false
            patchMessage(convId, asstId, {
              toolsNote: '上游这次不接工具调用 —— 这次没用上工具。',
            })
            continue
          }
          throw err
        }

        const calls = outcome.toolCalls ?? []
        if (!calls.length || toolLimitHit) break

        const wire = calls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.function.name, arguments: c.function.arguments },
        }))

        // 轮次用完 —— 回一句「到头了」，让模型用现有的信息收尾
        if (round >= MAX_TOOL_ROUNDS) {
          toolLimitHit = true
          outgoing = [
            ...outgoing,
            { role: 'assistant', content: turnContent, tool_calls: wire },
            ...calls.map((c) => ({
              role: 'tool' as const,
              tool_call_id: c.id,
              content: `工具轮次用完了（上限 ${MAX_TOOL_ROUNDS} 轮），请用已经拿到的信息回答。`,
            })),
          ]
          turnContent = ''
          continue
        }

        // 真去跑工具
        round += 1
        const toolMessages: OutgoingMessage[] = []
        for (const call of calls) {
          if (ctrl.signal.aborted) break
          const record: ToolCallRecord = {
            id: call.id,
            name: call.function.name,
            args: call.function.arguments,
            status: 'running',
          }
          toolRecords.push(record)
          patchMessage(convId, asstId, { tools: [...toolRecords] })

          const result = await runTool(call, { signal: ctrl.signal })
          record.status = result.ok ? 'done' : 'error'
          record.result = result.content
          record.summary = result.summary
          if (!result.ok) record.error = result.content
          patchMessage(convId, asstId, { tools: [...toolRecords] })

          toolMessages.push({ role: 'tool', tool_call_id: call.id, content: result.content })
        }

        // 工具的结果喂回去 —— 模型接着答
        outgoing = [
          ...outgoing,
          { role: 'assistant', content: turnContent, tool_calls: wire },
          ...toolMessages,
        ]
        turnContent = ''
      }

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
            ? reasoningMs + Math.round(performance.now() - reasoningStartedAt)
            : reasoningMs || undefined,
        truncated,
        // 工具要了但一件没跑成 —— 说清楚，别让用户对着空回答发呆
        ...(toolLimitHit && !toolRecords.length
          ? { content: '（工具轮次用完了，什么也没跑成。）' }
          : {}),
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
        // 排队提示到这儿就该收了 —— 不然「已停止」的消息上还挂着「即将重试」
        retry: undefined,
        error: aborted
          ? undefined
          : { message, detail: err instanceof ApiError ? err.detail : undefined },
        // 半路被打断也算想过：报出到这一刻为止的耗时
        reasoningMs:
          reasoningStartedAt !== null
            ? reasoningMs + Math.round(performance.now() - reasoningStartedAt)
            : reasoningMs || undefined,
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

    sendMessage: async (text, attachments) => {
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
        // 附件名记在这条消息上 —— 发给上游时要让模型看见
        ...(attachments && attachments.length ? { attachments } : {}),
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
    editMessage: async (messageId, text, attachments) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (get().streamingId) return

      const conv = get().conversations.find((c) => c.messages.some((m) => m.id === messageId))
      if (!conv) return
      const idx = conv.messages.findIndex((m) => m.id === messageId)
      if (idx < 0) return
      if (conv.messages[idx].role !== 'user') return

      const now = Date.now()
      const edited: Message = {
        ...conv.messages[idx],
        content: trimmed,
        createdAt: now,
        ...(attachments && attachments.length ? { attachments } : {}),
      }
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
