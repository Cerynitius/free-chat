import type { ReasoningEffort, Role } from '@/state/types'
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
  onFinish?: (reason: string | null) => void
}

/**
 * 跑完一次对话，把分片喂给回调。
 *
 * ★ 思考内容（reasoning_content）与正文（content）是**两个独立字段**，
 *   分片式到达 —— 必须分别累积、分别渲染。
 */
export async function runChat(p: ChatParams): Promise<'stop' | 'aborted'> {
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

  for await (const frame of readSSE(res)) {
    if (frame === '[DONE]') break
    let chunk: ChatChunk
    try {
      chunk = JSON.parse(frame) as ChatChunk
    } catch {
      continue // 坏帧跳过，不打断整条流
    }
    const choice = chunk.choices?.[0]
    if (!choice) continue
    const delta = choice.delta
    if (!delta) continue
    if (delta.reasoning_content) p.onReasoning(delta.reasoning_content)
    if (delta.content) p.onContent(delta.content)
    if (choice.finish_reason) p.onFinish?.(choice.finish_reason)
  }

  return p.signal.aborted ? 'aborted' : 'stop'
}