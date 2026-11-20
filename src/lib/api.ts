import type { ApiConfig, ConnectionMode, ModelInfo, Settings } from '@/state/types'

export type ApiErrorKind = 'network' | 'http' | 'parse' | 'abort'

/** 端点只放行这三个，其余一律 403 —— 代理与直连都一样。 */
export const ALLOWED_PATHS = ['/v1/chat/completions', '/v1/models', '/health'] as const

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
 * 构建期注入的 key。
 *
 * 生产环境由 CI 从仓库 secret VITE_API_KEY 注入 —— key 不进仓库，但会进发到
 * 公网的 bundle（任何人都能在 DevTools 里读到，这是「内置到网页」的必然结果）。
 * 代理模式下浏览器通常不需要它：key 存在代理侧。
 */
export const BUILTIN_KEY = (import.meta.env.VITE_API_KEY ?? '').trim()

/**
 * 构建期注入的默认代理地址。
 * 生产环境可以在仓库变量 VITE_PROXY_URL 里填 Cloudflare Worker 的地址 ——
 * 填了的话，访客打开就是「已配置好」的可用状态，不用先进设置面板。
 */
export const BUILTIN_PROXY_URL = (import.meta.env.VITE_PROXY_URL ?? '').trim()

/** 源站直连地址 —— 公开信息，直接写死 */
export const DEFAULT_BASE_URL = 'https://182.92.245.176:1920'

/**
 * 把设置换算成一次请求真正用到的连接参数。
 * key 优先用用户运行时填的，其次回落到构建期注入的内置 key。
 */
export function resolveApiConfig(settings: Settings): ApiConfig {
  const key = settings.apiKey.trim() || BUILTIN_KEY
  return settings.mode === 'proxy'
    ? { mode: 'proxy', baseUrl: settings.proxyUrl.trim(), apiKey: key }
    : { mode: 'direct', baseUrl: settings.baseUrl.trim(), apiKey: key }
}

export function normalizeBase(base: string): string {
  return base.trim().replace(/\/+$/, '')
}

export function chatEndpoint(cfg: ApiConfig): string {
  return `${normalizeBase(cfg.baseUrl)}/v1/chat/completions`
}

export function modelsEndpoint(cfg: ApiConfig): string {
  return `${normalizeBase(cfg.baseUrl)}/v1/models`
}

export function pingEndpoint(cfg: ApiConfig): string {
  return `${normalizeBase(cfg.baseUrl)}/__ping`
}

/**
 * 请求头。
 *
 * ★ 代理模式下默认**不带** Authorization —— key 由代理侧的 secret 注入，
 *   浏览器一个字节都拿不到。只有当代理自报「没有配置 key」时（proxyHasKey=false），
 *   才回退发送浏览器侧的 key，这样「代理没配 secret」也不是死路。
 */
export function buildHeaders(cfg: ApiConfig, proxyHasKey?: boolean): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
  }
  const key = cfg.apiKey.trim()
  const shouldSend = cfg.mode === 'direct' || !proxyHasKey
  if (shouldSend && key) h['Authorization'] = `Bearer ${key}`
  return h
}

/** GET /v1/models —— 兼做「连接测试」 */
export async function fetchModels(cfg: ApiConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  let res: Response
  try {
    res = await fetch(modelsEndpoint(cfg), { headers: buildHeaders(cfg), signal })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw new ApiError('已取消', 'abort')
    throw new ApiError(
      `连不上 ${normalizeBase(cfg.baseUrl)}：${(err as Error)?.message ?? '网络错误'}`,
      'network',
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(describeHttpError(res.status, text), 'http', res.status, extractCode(text))
  }
  const json = (await res.json()) as { data?: (ModelInfo | string)[] }
  const list = json?.data ?? []
  return list.map((m) => (typeof m === 'string' ? { id: m } : m))
}

/**
 * GET /__ping —— 代理自检。
 * 只有代理有这个端点；直连源站会 403，所以不是代理时静默返回 null。
 */
export async function pingProxy(
  cfg: ApiConfig,
  signal?: AbortSignal,
): Promise<{ reachable: boolean; latencyMs: number; error?: string; hasKey?: boolean } | null> {
  try {
    const res = await fetch(pingEndpoint(cfg), { headers: buildHeaders(cfg), signal })
    if (!res.ok) return null
    const json = (await res.json()) as {
      reachable?: boolean
      latencyMs?: number
      error?: string | null
      hasKey?: boolean
    }
    return {
      reachable: Boolean(json.reachable),
      latencyMs: Number(json.latencyMs ?? 0),
      error: json.error ?? undefined,
      hasKey: json.hasKey,
    }
  } catch {
    return null
  }
}

/** 把 HTTP 错误翻译成人话 */
export function describeHttpError(status: number, body: string): string {
  let msg = ''
  try {
    const j = JSON.parse(body) as { error?: { message?: string } }
    msg = j?.error?.message ?? ''
  } catch {
    msg = body.slice(0, 160)
  }
  const hint =
    status === 401
      ? ' —— key 不对；代理模式下则是代理侧还没配置 API_KEY'
      : status === 403
        ? ' —— 这个路径源站不允许访问（只开放 /v1/chat/completions、/v1/models、/health）'
        : status === 400
          ? ' —— 请求参数不对（注意 stream 必须是 true）'
          : ''
  return `HTTP ${status}${hint}${msg ? '：' + msg : ''}`
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
 * 浏览器层面的网络失败（fetch 抛 TypeError）几乎必然是 CORS 拦截：
 * 请求根本没发出去，或者响应根本没让 JS 看见。
 * 这一段文案是整个设置面板最有价值的部分 —— 别让人只看到一句 "Failed to fetch"。
 */
export function describeConnectionError(err: unknown, mode: ConnectionMode): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (mode === 'direct') {
    return (
      `连不上源站（${raw}）。` +
      '浏览器同源策略会拦掉跨源请求 —— 源站没有返回 Access-Control-Allow-Origin，' +
      '而且 OPTIONS 预检会被它的鉴权层以 401 挡掉。' +
      '两条出路：① 在设置里切到「代理」模式并填代理地址；' +
      '② 让服务器管理员在 nginx 里加上 CORS 片段（README 里有现成的）。'
    )
  }
  return (
    `连不上代理（${raw}）。` +
    '检查代理地址有没有写错、代理进程是否还在跑、URL 末尾有没有多一个斜杠。' +
    '本地代理可以用 `npm run proxy` 起一个，然后用 `/__ping` 自检。'
  )
}
