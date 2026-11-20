import type { ReasoningEffort, Role, Truncation } from '@/state/types'
import { MAX_TOKENS, MODEL, SYSTEM_PROMPT, TEMPERATURE, TOP_P } from '@/config'
import {
  ApiError,
  buildHeaders,
  chatEndpoint,
  describeConnectionError,
  describeHttpError,
  extractCode,
} from './api'
import { readSSE } from './sse'

export interface ChatChunk {
  id?: string
  model?: string
  choices?: {
    index?: number
    delta?: { role?: string; content?: string; reasoning_content?: string }
    finish_reason?: string | null
  }[]
}

export interface ChatParams {
  messages: { role: Role; content: string }[]
  effort: ReasoningEffort
  signal: AbortSignal
  onReasoning: (chunk: string) => void
  onContent: (chunk: string) => void
}

/** 一次生成的结果 —— 重点是「它到底有没有说完」。 */
export interface ChatOutcome {
  /** 上游给的结束原因：stop / length / content_filter…；没有就是 null */
  finishReason: string | null
  /** 流有没有正常收尾 —— 收到 [DONE] 或 finish_reason 才算正常 */
  endedCleanly: boolean
}

/**
 * 跑完一次对话，把分片喂给回调。
 *
 * ★ 思考内容（reasoning_content）与正文（content）是**两个独立字段**，
 *   分片式到达 —— 必须分别累积、分别渲染。
 */
export async function runChat(p: ChatParams): Promise<ChatOutcome> {
  const body = {
    model: MODEL,
    messages: SYSTEM_PROMPT.trim()
      ? [{ role: 'system' as const, content: SYSTEM_PROMPT }, ...p.messages]
      : p.messages,
    // ★ 这个后端强制要求 stream:true，stream:false 直接 400
    stream: true,
    reasoning_effort: p.effort,
    temperature: TEMPERATURE,
    top_p: TOP_P,
    max_tokens: MAX_TOKENS,
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
    throw new ApiError(describeHttpError(res.status, text), 'http', res.status, extractCode(text))
  }

  let finishReason: string | null = null
  let sawDone = false

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
    const choice = chunk.choices?.[0]
    if (!choice) continue
    // finish_reason 要**先**收 —— 有些上游的最后一帧不带 delta，
    // 放在 delta 判断后面会被 continue 吃掉，结束原因就丢了。
    if (choice.finish_reason) finishReason = choice.finish_reason
    const delta = choice.delta
    if (!delta) continue
    if (delta.reasoning_content) p.onReasoning(delta.reasoning_content)
    if (delta.content) p.onContent(delta.content)
  }

  return { finishReason, endedCleanly: sawDone || finishReason !== null }
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