import type { ApiConfig, ReasoningEffort, Role } from '@/state/types'
import { ApiError, buildHeaders, chatEndpoint, describeHttpError, extractCode } from './api'
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
  config: ApiConfig
  messages: { role: Role; content: string }[]
  model: string
  effort: ReasoningEffort
  temperature: number
  topP: number
  maxTokens: number
  systemPrompt: string
  signal: AbortSignal
  /** 代理是否自己持有 key —— 决定要不要在请求里带 Authorization */
  proxyHasKey?: boolean
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
    model: p.model,
    messages: p.systemPrompt.trim()
      ? [{ role: 'system' as const, content: p.systemPrompt }, ...p.messages]
      : p.messages,
    // ★ 这个后端强制要求 stream:true，stream:false 直接 400
    stream: true,
    reasoning_effort: p.effort,
    temperature: p.temperature,
    top_p: p.topP,
    max_tokens: p.maxTokens,
  }

  let res: Response
  try {
    res = await fetch(chatEndpoint(p.config), {
      method: 'POST',
      headers: buildHeaders(p.config, p.proxyHasKey),
      body: JSON.stringify(body),
      signal: p.signal,
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw new ApiError('已停止', 'abort')
    throw new ApiError(
      `连不上 ${p.config.baseUrl}：${(err as Error)?.message ?? '网络错误'}`,
      'network',
    )
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
