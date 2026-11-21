import type { OutgoingMessage, ReasoningEffort, Truncation, WireToolCall } from '@/state/types'
import { MAX_TOKENS, MODEL, SYSTEM_PROMPT, TEMPERATURE, TOP_P } from '@/config'
import {
  ApiError,
  buildHeaders,
  chatEndpoint,
  describeConnectionError,
  describeHttpError,
  extractCode,
  friendlyStreamError,
} from './api'
import { readSSE } from './sse'
import type { ToolDefinition } from './tools'

export interface ChatChunk {
  id?: string
  model?: string
  choices?: {
    index?: number
    delta?: {
      role?: string
      content?: string
      reasoning_content?: string
      tool_calls?: {
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }[]
    }
    finish_reason?: string | null
  }[]
}

export interface ChatParams {
  messages: OutgoingMessage[]
  effort: ReasoningEffort
  signal: AbortSignal
  onReasoning: (chunk: string) => void
  onContent: (chunk: string) => void
  /** 发给上游的工具清单 —— 不给就是不带工具 */
  tools?: ToolDefinition[]
  /** 用户的自定义指令（设置里填的），附在系统提示后面 */
  instructions?: string
}

/** 一次生成的结果 —— 重点是「它到底有没有说完」。 */
export interface ChatOutcome {
  /** 上游给的结束原因：stop / length / content_filter…；没有就是 null */
  finishReason: string | null
  /** 流有没有正常收尾 —— 收到 [DONE] 或 finish_reason 才算正常 */
  endedCleanly: boolean
  /**
   * 这一轮模型要调的工具。
   *
   * 上游把参数拆成一小段一小段发过来（arguments 是分片的），
   * 这里按 index 拼回去。
   */
  toolCalls?: WireToolCall[]
}

/**
 * 跑完一次对话，把分片喂给回调。
 *
 * ★ 思考内容（reasoning_content）与正文（content）是**两个独立字段**，
 *   分片式到达 —— 必须分别累积、分别渲染。
 */
export async function runChat(p: ChatParams): Promise<ChatOutcome> {
  const system = [
    SYSTEM_PROMPT.trim(),
    p.instructions?.trim() ? `用户的自定义指令（每一轮都要遵守）：\n${p.instructions.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const body = {
    model: MODEL,
    messages: system
      ? ([{ role: 'system' as const, content: system }, ...p.messages] as OutgoingMessage[])
      : p.messages,
    // ★ 这个后端强制要求 stream:true，stream:false 直接 400
    stream: true,
    reasoning_effort: p.effort,
    temperature: TEMPERATURE,
    top_p: TOP_P,
    max_tokens: MAX_TOKENS,
    // 带了工具，上游才会调工具 —— 不带的话它只会聊天
    ...(p.tools && p.tools.length ? { tools: p.tools } : {}),
  }

  let res: Response
  try {
    res = await fetch(chatEndpoint(), {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: p.signal,
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw new ApiError('已停止', 'abort')
    throw new ApiError(describeConnectionError(err), 'network')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const { message, detail } = describeHttpError(res.status, text)
    throw new ApiError(message, 'http', res.status, extractCode(text), detail)
  }

  let finishReason: string | null = null
  let sawDone = false
  /** 工具调用按 index 拼 —— 参数是一小段一小段来的 */
  const pendingTools = new Map<number, { id: string; name: string; args: string }>()

  for await (const frame of readSSE(res)) {
    if (frame === '[DONE]') {
      sawDone = true
      break
    }
    let chunk: ChatChunk
    try {
      chunk = JSON.parse(frame) as ChatChunk
    } catch {
      continue // 坏帧跳过，不打断整条流
    }
    // 有些错误是**流里**来的（200 的正文里塞一句 error）——
    // 不认它的话，流会静悄悄地断掉，界面上只剩一句「连接中断」。
    const inline = (chunk as { type?: string; error?: { type?: string; code?: string; message?: string } })
      .error
    if (inline || (chunk as { type?: string }).type === 'error') {
      const info = inline ?? { message: '上游在流里报了一个错' }
      const { message, detail } = friendlyStreamError(info)
      throw new ApiError(message, 'http', 429, info.code, detail)
    }
    const choice = chunk.choices?.[0]
    if (!choice) continue
    // finish_reason 要**先**收 —— 有些上游的最后一帧不带 delta，
    // 放在 delta 判断后面会被 continue 吃掉，结束原因就丢了。
    if (choice.finish_reason) finishReason = choice.finish_reason
    const delta = choice.delta
    if (!delta) continue
    if (delta.reasoning_content) p.onReasoning(delta.reasoning_content)
    if (delta.content) p.onContent(delta.content)
    // 工具调用：名字和参数是分开来的，参数还是分片的
    for (const call of delta.tool_calls ?? []) {
      const index = call.index ?? 0
      const entry = pendingTools.get(index) ?? { id: '', name: '', args: '' }
      if (call.id) entry.id = call.id
      if (call.function?.name) entry.name = call.function.name
      if (call.function?.arguments) entry.args += call.function.arguments
      pendingTools.set(index, entry)
    }
  }

  const toolCalls: WireToolCall[] = [...pendingTools.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, call]) => call.name)
    .map(([, call]) => ({
      id: call.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      type: 'function' as const,
      function: { name: call.name, arguments: call.args || '{}' },
    }))

  return {
    finishReason,
    endedCleanly: sawDone || finishReason !== null,
    ...(toolCalls.length ? { toolCalls } : {}),
  }
}

/**
 * 判断这次生成是不是被截断了。
 *
 * 三种来由：
 *   length        —— 撞到 max_tokens 上限。思考和正文共用这一个预算，
 *                    所以「想太久」会把正文直接挤没了（最常见的一种）。
 *   content-filter—— 上游的过滤器把内容截了。
 *   stream        —— 流提前断了：既没收到 [DONE]，也没有 finish_reason。
 *                    这种最容易被误当成「正常结束」，必须点出来。
 */
export function describeTruncation(outcome: ChatOutcome): Truncation | undefined {
  if (outcome.finishReason === 'length') {
    return { kind: 'length', finishReason: outcome.finishReason }
  }
  if (outcome.finishReason === 'content_filter') {
    return { kind: 'content-filter', finishReason: outcome.finishReason }
  }
  if (!outcome.endedCleanly) {
    return { kind: 'stream', finishReason: outcome.finishReason }
  }
  return undefined
}

/** 起标题的请求超时（毫秒）—— 起个名而已，不值得等太久 */
const TITLE_TIMEOUT_MS = 12_000

/**
 * 让模型给这段对话起个名。
 *
 * 跟正文分开走：关思考、限字数、限时间。
 * 失败就返回 null —— 调用方退回本地抠出来的标题，界面永远有名字。
 */
export async function fetchTitle(source: string, signal?: AbortSignal): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), TITLE_TIMEOUT_MS)
  const onAbort = (): void => ctrl.abort()
  signal?.addEventListener('abort', onAbort)

  try {
    const body = {
      model: MODEL,
      messages: [
        {
          role: 'user' as const,
          content:
            '给下面这段对话起一个简短的标题，只输出标题本身，不要引号、标点和解释，最多 20 个字：\n\n' +
            source.slice(0, 2000),
        },
      ],
      // ★ 这个后端强制要求 stream:true
      stream: true,
      reasoning_effort: 'off',
      temperature: 0.3,
      top_p: 1,
      max_tokens: 64,
    }

    const res = await fetch(chatEndpoint(), {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) return null

    let out = ''
    for await (const frame of readSSE(res)) {
      if (frame === '[DONE]') break
      try {
        const chunk = JSON.parse(frame) as ChatChunk
        const piece = chunk.choices?.[0]?.delta?.content
        if (piece) out += piece
      } catch {
        continue // 坏帧跳过
      }
      if (out.length > 120) break // 起个名而已，够了
    }
    return out.trim() || null
  } catch {
    return null // 起名失败不是错误 —— 有兜底标题
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}