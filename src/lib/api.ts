import { API_KEY, BASE_URL, PROXY_URL } from '@/config'

export type ApiErrorKind = 'network' | 'http' | 'parse' | 'abort'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number
  readonly code?: string

  constructor(message: string, kind: ApiErrorKind, status?: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.code = code
  }
}

/**
 * 实际要打到哪里。
 *
 * 配了代理地址就走代理（代理补 CORS 头），没配就直连源站 ——
 * 直连能不能成，取决于源站有没有开 CORS（默认没有，会被浏览器拦）。
 */
export function endpoint(): string {
  return (PROXY_URL || BASE_URL).replace(/\/+$/, '')
}

export function chatEndpoint(): string {
  return `${endpoint()}/v1/chat/completions`
}

/**
 * 请求头。
 *
 * key 总是带上：代理侧配了 secret 时它会用自己的覆盖掉，
 * 没配时正好用这一个 —— 两条路都通。
 */
export function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
  }
  if (API_KEY) h['Authorization'] = `Bearer ${API_KEY}`
  return h
}

/** 把 HTTP 错误翻译成人话 —— 一行，不长篇大论 */
export function describeHttpError(status: number, body: string): string {
  let msg = ''
  try {
    const j = JSON.parse(body) as { error?: { message?: string } }
    msg = j?.error?.message ?? ''
  } catch {
    msg = body.slice(0, 120)
  }
  return `HTTP ${status}${msg ? ' · ' + msg : ''}`
}

export function extractCode(body: string): string | undefined {
  try {
    const j = JSON.parse(body) as { error?: { code?: string } }
    return j?.error?.code
  } catch {
    return undefined
  }
}

/**
 * 连不上时的提示 —— 只给一行。
 *
 * 浏览器层面的 fetch 失败（TypeError）在直连模式下几乎必然是 CORS：
 * 请求要么没发出去，要么响应根本没让 JS 看见。
 */
export function describeConnectionError(err: unknown): string {
  // 原始错误只进控制台 —— 界面上一行就够，堆细节反而看不清
  console.warn('[chat] 连接失败', err)
  return PROXY_URL
    ? '连不上代理 · 确认代理还在运行'
    : '连不上源站 · 浏览器会拦掉跨源请求，需要配代理地址'
}