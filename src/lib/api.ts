import { API_KEY, BASE_URL, PROXY_URL } from '@/config'

export type ApiErrorKind = 'network' | 'http' | 'parse' | 'abort'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number
  readonly code?: string
  /** 上游原话 —— 排查用；界面上排在人话后面，当小字显示 */
  readonly detail?: string

  constructor(
    message: string,
    kind: ApiErrorKind,
    status?: number,
    code?: string,
    detail?: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.code = code
    this.detail = detail
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

/** 上游错误正文里能认出来的几样东西 */
interface UpstreamError {
  type?: string
  code?: string
  message?: string
  hint?: string
}

/**
 * 拆上游的错误正文。
 *
 * 形状不止一种：
 *   {"type":"error","error":{"type":"rate_limit_error","code":"concurrency_limit",...}}
 *   {"error":{"type":"forbidden","message":"..."}}
 *   {"error":{"type":"upstream_unreachable","message":"...","hint":"..."}}
 *   nginx 的 HTML 401 页面（不是 JSON）
 */
function parseErrorBody(body: string): UpstreamError | null {
  try {
    const j = JSON.parse(body) as {
      type?: string
      error?: { type?: string; code?: string; message?: string; hint?: string }
      hint?: string
    }
    const e = j?.error
    return {
      type: e?.type ?? j?.type,
      code: e?.code,
      message: e?.message,
      hint: j?.hint ?? e?.hint,
    }
  } catch {
    return null
  }
}

/**
 * 把上游的机器话翻成人话。
 *
 * 上游写的是给程序看的口径（"too many concurrent requests from your IP
 * (limit 1)"）—— 原样甩到界面上，没几个人知道下一步该干什么。
 * 这里按状态码和 code 认几种常见情况，各给一句能照着做的话；
 * 认不出来就退回「HTTP xxx」，但上游原话一定留着，排查用得上。
 */
function friendly(status: number, info: UpstreamError): { message: string; detail?: string } {
  const code = info.code ?? ''
  const raw = info.message ?? ''

  // 上游同时只跑一个请求，第二个被挤掉
  if (status === 429 || code === 'concurrency_limit' || /concurren/i.test(raw)) {
    return {
      message:
        '上游同时只接一个请求（服务商最大并行数 1），这次被挤掉了 —— 得等前一个跑完。',
      detail: raw,
    }
  }

  // 密钥不对或没带
  if (status === 401) {
    return {
      message:
        '接口密钥没带或者不对（上游回了 401）。走代理时密钥由代理注入；直连的话要配 VITE_API_KEY 再重新构建。',
      detail: raw,
    }
  }

  // 代理的白名单不认这个地址
  if (status === 403 && info.type === 'forbidden') {
    return {
      message: '这个地址代理不转发（403）—— 代理只放行 /v1/chat/completions、/v1/models、/health。',
      detail: raw,
    }
  }

  // 代理自己报「连不上上游」
  if (status === 502 || info.type === 'upstream_unreachable') {
    return {
      message:
        '连不上上游 —— 代理到源站这一段没通。源站在境内，直连需要能通到它的网络（境外可能需要 VPN），或者换一个代理。',
      detail: info.hint ?? raw,
    }
  }

  // 上游拒绝了这个请求（地区限制一类）
  if (status === 403) {
    return {
      message:
        '上游拒绝了这个请求（403）。源站在境内，从境外访问可能被限 —— 试试 VPN，或者走代理。',
      detail: raw,
    }
  }

  if (status === 404) {
    return { message: '上游没有这个地址（404）—— 代理地址或者路径不对。', detail: raw }
  }

  if (status >= 500) {
    return { message: `上游自己出问题了（HTTP ${status}）—— 过一会儿再试。`, detail: raw }
  }

  // 状态码是 0 ⇒ 错误是从流里来的，没有 HTTP 状态可言
  if (status === 0) {
    return { message: '上游在流里报了一个错。', detail: raw || undefined }
  }

  return { message: `上游回了 HTTP ${status}`, detail: raw || undefined }
}

/** 流里带来的错误 —— 跟 HTTP 错误走同一套人话 */
export function friendlyStreamError(info: {
  type?: string
  code?: string
  message?: string
}): { message: string; detail?: string } {
  return friendly(0, info)
}

/** 把 HTTP 错误翻译成人话 —— 一行，不长篇大论 */
export function describeHttpError(status: number, body: string): { message: string; detail?: string } {
  const info = parseErrorBody(body)
  if (!info) {
    // 不是 JSON —— 多半是 nginx 的 HTML 错误页（比如 401）
    const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    return friendly(status, { message: text })
  }
  return friendly(status, info)
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
 * 连不上时的提示 —— 也给人话。
 *
 * 浏览器层面的 fetch 失败（TypeError）在直连模式下几乎必然是 CORS：
 * 请求要么没发出去，要么响应根本没让 JS 看见。
 */
export function describeConnectionError(err: unknown): string {
  // 原始错误只进控制台 —— 界面上给一句就够，堆细节反而看不清
  console.warn('[chat] 连接失败', err)
  return PROXY_URL
    ? '连不上代理 · 确认代理还在运行（代理自己报连不上上游时，提示会写得更细）'
    : '连不上源站 · 源站在境内，直连需要能通到它的网络（境外可能需要 VPN）；也可以把 VITE_PROXY_URL 指向一个代理地址。'
}

/**
 * 这个错误是不是「上游满了」——
 * 上游同一时间只接一个请求，第二个会被 429 挡回来。
 */
export function isConcurrencyError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  if (err.kind !== 'http') return false
  if (err.status === 429) return true
  if (err.code === 'concurrency_limit') return true
  return /concurren|too many/i.test(err.detail ?? '') || /并发|并行/i.test(err.message)
}
