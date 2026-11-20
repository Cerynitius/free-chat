/**
 * CORS + SSE 反向代理的核心逻辑。
 *
 * 为什么需要它：上游 API 一个 CORS 响应头都没有，而且 OPTIONS 预检会被它的
 * nginx 鉴权层以 401 挡掉。浏览器里的 JS 因此无法直连，只能在中间站一层。
 * 这一层干三件事：补 CORS 头、注入留在服务端的 key、把 SSE 原样流式透传。
 *
 * 零运行时依赖，只用 Web 标准 API —— 同一份代码能在 Cloudflare Workers、
 * Deno Deploy、Vercel Edge 和 Node 上跑，env 的差异全部收敛到 resolveEnv()。
 */

/** 上游默认地址。只有这个 IP + 这个端口能通，http:// 会被 nginx 用 400 挡掉。 */
export const DEFAULT_UPSTREAM = 'https://182.92.245.176:1920'

/**
 * 上游只放行这三条路径。代理保持同样的白名单 —— 不多不少，
 * 免得代理变成一个可以任意探上游的跳板。
 */
const ALLOWED_PATHS = ['/v1/chat/completions', '/v1/models', '/health']

/**
 * 逐跳头：连接级别的信息，只对当前这一跳有意义，转发出去只会让下游出错
 * （尤其是 transfer-encoding：Node 会自己决定分帧方式）。
 */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/**
 * 把各个运行时的环境变量揉成一个对象。
 *
 * 平台差异：
 *   - Cloudflare Workers: env 由平台注入（fetch 的第二个参数）
 *   - Deno Deploy:        env 也是第二个参数；本地跑则是 Deno.env
 *   - Vercel Edge:        只有 process.env
 *   - Node:               process.env
 *
 * 显式传进来的 env 优先级最高 —— 平台注入的值最权威，最后 put 覆盖前面的。
 */
function resolveEnv(explicit) {
  const merged = {}
  const put = (source) => {
    if (!source || typeof source !== 'object') return
    for (const key of Object.keys(source)) {
      const value = source[key]
      if (value !== undefined && value !== null) merged[key] = value
    }
  }
  put(globalThis.process?.env)
  try {
    put(globalThis.Deno?.env?.toObject?.())
  } catch {
    // Deno 没给 --allow-env 时 toObject() 会抛错，忽略即可
  }
  put(explicit)
  return merged
}

/** 解析配置。ALLOWED_ORIGINS 是逗号分隔的 Origin 白名单，空 = 放行全部。 */
function resolveConfig(env) {
  const source = resolveEnv(env)
  const upstream = String(source.UPSTREAM || DEFAULT_UPSTREAM)
    .trim()
    .replace(/\/+$/, '')
  const apiKey = String(source.API_KEY || '').trim()
  const allowedOrigins = String(source.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return { upstream, apiKey, allowedOrigins }
}

/**
 * 上游地址可以来自「指针」—— 一个公开可读的文本文件，里面写着当前隧道地址。
 *
 * 为什么需要：隧道地址每次重启都会变。如果把它写死在构建产物里，
 * 换一次隧道就要重新部署一次。改成运行时去读一个指针文件，
 * 换隧道只要更新那个文件，Worker 自己就跟上（见 UPSTREAM_POINTER）。
 */
let pointerCache = { url: '', at: 0 }
const POINTER_TTL_MS = 30_000

async function resolveUpstream(env, config) {
  const pointer = String(env.UPSTREAM_POINTER || '').trim()
  if (!pointer) return config.upstream

  const now = Date.now()
  if (pointerCache.url && now - pointerCache.at < POINTER_TTL_MS) return pointerCache.url

  try {
    // 带分钟级时间戳，绕开 raw 的 5 分钟缓存
    const bust = Math.floor(now / 60000)
    const sep = pointer.includes('?') ? '&' : '?'
    const res = await fetch(pointer + sep + 't=' + bust, { headers: { 'Cache-Control': 'no-cache' } })
    if (!res.ok) throw new Error('pointer HTTP ' + res.status)
    const text = (await res.text()).trim()
    if (!/^https?:\/\//i.test(text)) throw new Error('pointer does not contain a URL')
    pointerCache = { url: text.replace(/\/+$/, ''), at: now }
    return pointerCache.url
  } catch (err) {
    // 指针读不到就沿用上次的结果，别让整条代理挂掉
    console.warn('[proxy] 读上游指针失败：', err && err.message ? err.message : err)
    return pointerCache.url || config.upstream
  }
}

/**
 * 组装 CORS 头。
 *
 * 白名单为空 = 放行全部，回 '*'。
 * 白名单非空时，只有名单内的 Origin 才回 Access-Control-Allow-Origin；
 * 名单外的一律**不设**这个头 —— 回一个别的值（比如回显但标记失败）只会误导
 * 排查的人，该让浏览器自己去拦。
 */
function buildCorsHeaders(origin, allowedOrigins) {
  const headers = new Headers()
  if (allowedOrigins.length === 0) {
    headers.set('Access-Control-Allow-Origin', '*')
  } else if (origin && allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Accept, X-Requested-With',
  )
  headers.set('Access-Control-Expose-Headers', 'Content-Type')
  headers.set('Access-Control-Max-Age', '86400')
  headers.set('Vary', 'Origin')
  return headers
}

/** 统一的 JSON 响应：CORS 头一个都不能少，前端要靠它读错误信息。 */
function jsonResponse(status, payload, cors) {
  const headers = new Headers(cors)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(payload, null, 2), { status, headers })
}

/**
 * 把错误摊开成人话。
 *
 * Node 自带的 fetch 失败时 message 只是一句 "fetch failed"，真正的原因
 * （连不上、证书过期、超时）藏在 cause 里 —— 不摊开的话排查的人只能看到一句废话。
 */
function describeError(err) {
  const parts = []
  const seen = new Set()
  let current = err
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const name = current.name || 'Error'
    const message = current.message || String(current)
    parts.push(parts.length === 0 ? `${name}: ${message}` : `(${name}: ${message})`)
    current = current.cause
  }
  return parts.join(' <- ')
}

/** 去掉结尾多余的斜杠，让 /v1/models/ 和 /v1/models 走同一条白名单判断。 */
function normalizePath(pathname) {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/**
 * 组装发往上游的请求头。
 *
 * Authorization：优先用服务端的 key —— 它必须留在服务端，不能落到浏览器。
 * 代理侧没配 key 时才透传客户端带来的 Authorization，这样「没配 secret」
 * 也不是死路（前端在代理自报 hasKey=false 时会退回自己发 key）。
 */
function buildUpstreamHeaders(request, config) {
  const headers = new Headers()
  const contentType = request.headers.get('Content-Type')
  if (contentType) headers.set('Content-Type', contentType)
  const accept = request.headers.get('Accept')
  if (accept) headers.set('Accept', accept)
  if (config.apiKey) {
    headers.set('Authorization', `Bearer ${config.apiKey}`)
  } else {
    const authorization = request.headers.get('Authorization')
    if (authorization) headers.set('Authorization', authorization)
  }
  // 明确要明文：省掉一整类「解压了两遍 / 长度对不上」的坑（见 buildUpstreamResponse）
  headers.set('Accept-Encoding', 'identity')
  return headers
}

/**
 * GET /__ping —— 真探针，不是「我在运行」的假探针。
 *
 * 部署完第一件事就该 curl 它。Cloudflare Workers 到非标准端口（1920）的连通性
 * 在不同产品线上表现不一致，必须一眼看出「到底通没通」，而不是等聊天失败才发现。
 */
async function handlePing(request, config, cors) {
  const startedAt = Date.now()
  let reachable = false
  let error = null
  let sample = ''
  let upstreamStatus = null

  // 自己兜住超时：连不上的时候不能让探针一直挂着
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`${config.upstream}/health`, {
      method: 'GET',
      headers: buildUpstreamHeaders(request, config),
      signal: controller.signal,
    })
    upstreamStatus = res.status
    const text = await res.text()
    sample = text.slice(0, 400)
    reachable = true
    if (!res.ok) {
      error = `upstream responded HTTP ${res.status}: ${text.slice(0, 200)}`
    }
  } catch (err) {
    // 原始错误必须原样带出去 —— 吞掉的话排查的人什么都看不到
    error = describeError(err)
  } finally {
    clearTimeout(timer)
  }

  const ok = reachable && upstreamStatus !== null && upstreamStatus >= 200 && upstreamStatus < 300
  return jsonResponse(
    200,
    {
      ok,
      upstream: config.upstream,
      hasKey: Boolean(config.apiKey),
      reachable,
      latencyMs: Date.now() - startedAt,
      error,
      sample,
      time: new Date().toISOString(),
      upstreamStatus,
    },
    cors,
  )
}

/**
 * 把上游响应原样搬回来，再补上 CORS 头。
 *
 * 关键点：body 直接用 res.body（ReadableStream）透传，**绝不能**读成字符串再吐回去
 * —— 那样 SSE 会被攒成一坨，流式就没了。
 */
function buildUpstreamResponse(res, cors) {
  const headers = new Headers()
  for (const [name, value] of res.headers) {
    if (HOP_BY_HOP_HEADERS.has(name)) continue
    headers.set(name, value)
  }

  // Node 自带的 fetch（undici）收到 gzip/br 会自动解压，但**不会**顺手删掉
  // content-encoding 和 content-length。原样转发的话，下游会去解压一段已经
  // 解压过的字节，而且长度也对不上 —— 这对头必须丢掉。
  if (headers.get('Content-Encoding')) {
    headers.delete('Content-Encoding')
    headers.delete('Content-Length')
  }

  // CORS 头以我们为准：上游一个都没有，就算以后上游加了也不该盖掉白名单逻辑
  for (const [name, value] of cors) headers.set(name, value)

  const contentType = headers.get('Content-Type') || ''
  if (contentType.includes('text/event-stream')) {
    headers.set('Content-Type', 'text/event-stream; charset=utf-8')
    headers.set('Cache-Control', 'no-cache, no-transform')
    // 告诉 nginx 别缓冲这条响应，否则流式会被 nginx 攒成一大坨
    headers.set('X-Accel-Buffering', 'no')
    headers.delete('Content-Length')
  }

  const nullBody = res.status === 204 || res.status === 304
  return new Response(nullBody ? null : res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

/**
 * 往上游发请求。
 *
 * body 用流直接接过去（不缓冲）。部分运行时要求流式 body 必须带 duplex:'half'，
 * 万一某个运行时连这个都拒绝，退化成整体读取再发 —— 请求体只是个几百字节的
 * JSON，兜底不伤性能，但至少不会让代理整个挂掉。
 */
async function fetchUpstream(url, init, request) {
  try {
    return await fetch(url, init)
  } catch (err) {
    const message = String(err?.message ?? err)
    if (!/duplex/i.test(message) || !request?.body) throw err
    try {
      const buffered = await request.arrayBuffer()
      const retryInit = { ...init }
      delete retryInit.duplex
      retryInit.body = buffered
      return await fetch(url, retryInit)
    } catch {
      throw err
    }
  }
}

/**
 * 核心入口。Cloudflare Workers / Deno Deploy / Vercel Edge / Node 都调它。
 *
 * @param {Request} request
 * @param {Record<string, string | undefined>} [env] 平台注入的环境变量
 * @returns {Promise<Response>}
 */
export async function handleRequest(request, env) {
  const config = resolveConfig(env)
  const upstream = await resolveUpstream(env, config)
  const cors = buildCorsHeaders(request.headers.get('Origin'), config.allowedOrigins)
  const url = new URL(request.url)
  const path = normalizePath(url.pathname)

  // 预检必须自己应答：上游的 nginx 鉴权层会把 OPTIONS 用 401 挡掉，
  // 等它应答的话浏览器根本不会发出真正的请求。
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (path === '/__ping') {
    return handlePing(request, { ...config, upstream }, cors)
  }

  if (!ALLOWED_PATHS.includes(path)) {
    return jsonResponse(
      403,
      {
        error: {
          type: 'forbidden',
          message: `${url.pathname} is not allowed on this endpoint`,
        },
      },
      cors,
    )
  }

  const upstreamUrl = upstream + path + url.search
  const init = {
    method: request.method,
    headers: buildUpstreamHeaders(request, config),
  }
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
    // body 直接接过去，不缓冲 —— 一旦读成字符串再吐出去，流式就没了
    init.body = request.body
    init.duplex = 'half'
  }

  let res
  try {
    res = await fetchUpstream(upstreamUrl, init, request)
  } catch (err) {
    const message = describeError(err)
    return jsonResponse(
      502,
      {
        error: { type: 'upstream_unreachable', message },
        hint:
          `连不上上游 ${config.upstream}。先核对地址和端口（上游只接受 https，http 会被 nginx 用 400 挡掉）；` +
          '若部署在 Cloudflare Workers，注意 Workers 到非标准端口（1920）的连通性在不同产品线上不一致，' +
          '可以改用 Deno Deploy、Vercel Edge 或自建 Node 代理。',
      },
      cors,
    )
  }

  return buildUpstreamResponse(res, cors)
}

export default { fetch: handleRequest }
