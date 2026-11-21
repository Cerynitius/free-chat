/**
 * 工具接口：搜索、抓页面、认字、读文档。
 *
 * 为什么在这里：浏览器里的 JS 抓不了这些 —— 搜索引擎和站点都不给 CORS 头，
 * 而且代理本来就是唯一有「服务器视角」的一层。工具跑在服务端，
 * 浏览器只负责把参数递过来、把结果收回去。
 *
 * 零运行时依赖，只用 Web 标准 API —— 同一份代码在 Cloudflare Workers、
 * Deno Deploy、Vercel 和 Node 上都能跑。
 */

/** 这几条路径由本文件处理，不转发给上游。 */
export const TOOL_PATHS = ['/tools/search', '/tools/fetch', '/tools/ocr', '/tools/document']

/** 搜索结果最多几条 —— 再多模型也用不完，而且白占上下文。 */
const MAX_RESULTS = 8

/** 摘要最多留多少字。 */
const MAX_SNIPPET = 300

/** 抓回来的正文最多留多少字。 */
const MAX_FETCH_CHARS = 20_000

/** 认字/读文档的返回最多留多少字。 */
const MAX_DOC_CHARS = 30_000

/** 文档翻页时的硬上限（服务那头自己也会限一道）。 */
const HARD_DOC_CHARS = 200_000

/** 工具自己的超时（毫秒）。 */
const TOOL_TIMEOUT_MS = 25_000

/** 找页面用的浏览器 UA —— 不给的话不少站点直接返一个空壳。 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// ── 小工具 ─────────────────────────────────────────────────

/** 统一的 JSON 响应 */
export function jsonResponse(status, payload, cors) {
  const headers = new Headers(cors)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(payload), { status, headers })
}

/** 去掉标签，剩下能看的文字 */
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&ensp;|&emsp;|&thinsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    // 中文标题在 HTML 里常被 <strong> 拆开，拆开的地方会留下空格 ——
    // 「北京 今天天气 预报」读着别扭，把汉字之间的空格去掉（扫两遍，
    // 一遍只能去掉隔一个的）。
    .replace(/([　-〿一-鿿])\s+(?=[　-〿一-鿿])/g, '$1')
    .replace(/([　-〿一-鿿])\s+(?=[　-〿一-鿿])/g, '$1')
    .trim()
}

/** 取 <title> */
export function extractTitle(html) {
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return ''
  return htmlToText(m[1]).slice(0, 200)
}

/**
 * 自己兜住超时。
 *
 * 传入的必须是一个**函数** —— 只有这样才能把 AbortSignal 传进去，
 * 超时才能真的掐断请求。（早先写成直接传 promise，结果超时掐不断，
 * 请求在外头挂着，回调一抛错就成了没人接的悬空 promise。）
 */
async function withTimeout(run, ms, label) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await run(controller.signal)
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`${label}超时了（${ms / 1000} 秒）`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ── SSRF 防护 ──────────────────────────────────────────────
//
// 这个代理是公网可达的，而网址是**模型挑的**。不设防的话，
// 模型可以让这个代理去访问部署机器的内网地址和云厂商的元数据接口。

/** 这些网段不许碰：内网、回环、链路本地、保留、组播。 */
function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10/8
  if (a === 127) return true // 回环
  if (a === 169 && b === 254) return true // 链路本地（含云元数据 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true // 192.168/16
  if (a === 192 && b === 0 && p[2] === 0) return true // 192.0.0/24
  if (a === 192 && b === 0 && p[2] === 2) return true // 文档用
  if (a === 198 && (b === 18 || b === 19)) return true // 基准测试段
  if (a === 198 && b === 51 && p[2] === 100) return true // 文档用
  if (a === 203 && b === 0 && p[2] === 113) return true // 文档用
  if (a === 100 && b >= 64 && b <= 127) return true // 运营商级 NAT
  if (a >= 224) return true // 组播与保留
  return false
}

function isPrivateIPv6(ip) {
  const v = ip.toLowerCase().split('%')[0]
  if (v === '::1' || v === '::') return true
  // IPv4 映射/兼容地址：直接按 IPv4 判
  const m4 = v.match(/:((?:\d{1,3}\.){3}\d{1,3})$/)
  if (m4) return isPrivateIPv4(m4[1])
  if (v.startsWith('fc') || v.startsWith('fd')) return true // 唯一本地地址
  if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) {
    return true // 链路本地
  }
  if (v.startsWith('ff')) return true // 组播
  return false
}

/** 是不是一个 IP 字面量 */
function isIpLiteral(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

/** 这个 IP 是不是不许访问的 */
function isBlockedAddress(ip) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return isPrivateIPv4(ip)
  if (ip.includes(':')) return isPrivateIPv6(ip)
  return true // 看不懂的地址一律当坏的
}

/**
 * 用 DNS-over-HTTPS 把域名解析成 IP —— 纯 fetch，四个运行时都能用
 * （Node 里没法用 require('dns')，那会把这个文件钉死在 Node 上）。
 */
async function resolveHost(host) {
  // 几家同时问，谁先给出地址用谁：部署在境内时 Cloudflare / Google 的 DoH 不通，
  // 逐个试会先白等两轮超时；阿里的 /resolve 是同一种 JSON 格式，境内外都能连。
  const endpoints = [
    (name, type) =>
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    (name, type) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    (name, type) => `https://dns.alidns.com/resolve?name=${encodeURIComponent(name)}&type=${type}`,
  ]
  const ask = async (url) => {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
      })
      if (!res.ok) return []
      const json = await res.json()
      return (json.Answer || [])
        .filter((a) => a.type === 1 || a.type === 28)
        .map((a) => String(a.data))
    } catch {
      return []
    }
  }
  const lookups = endpoints.map(async (build) => {
    const [a, aaaa] = await Promise.all([ask(build(host, 'A')), ask(build(host, 'AAAA'))])
    const ips = [...a, ...aaaa]
    if (!ips.length) throw new Error('no answer')
    return ips
  })
  try {
    return await Promise.any(lookups)
  } catch {
    return []
  }
}

/**
 * 拦下内网地址。
 *
 * 判的是**解析出来的 IP**，不是域名 —— 域名可以指向内网，
 * 而且只判域名的话，一次 DNS rebinding 就能绕过。
 */
export async function assertPublicUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('这不是一个网址')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http 和 https')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIpLiteral(host)) {
    if (isBlockedAddress(host)) throw new Error('这个地址在内网或保留网段，不能访问')
    return url
  }
  const ips = await resolveHost(host)
  if (!ips.length) throw new Error('这个域名解析不出 IP')
  for (const ip of ips) {
    if (isBlockedAddress(ip)) {
      throw new Error('这个域名指向内网地址，不能访问')
    }
  }
  return url
}

/**
 * 抓一个网址，自己管重定向 —— 每跳都重查一遍 IP。
 */
async function fetchPublic(raw, init = {}) {
  let current = raw
  for (let hop = 0; hop < 5; hop++) {
    const url = await assertPublicUrl(current)
    const res = await fetch(url.toString(), {
      ...init,
      redirect: 'manual',
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Encoding': 'identity',
        ...(init.headers || {}),
      },
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), url).toString()
      continue
    }
    return res
  }
  throw new Error('重定向跳太多次了')
}

// ── 搜索 ───────────────────────────────────────────────────

/** SearXNG —— 自建的开源元搜索，接口干净，但要先自己起一个。 */
async function searchSearxng(base, query, signal) {
  const res = await fetch(
    `${base.replace(/\/+$/, '')}/search?q=${encodeURIComponent(query)}&format=json&language=zh`,
    { headers: { Accept: 'application/json' }, signal },
  )
  if (!res.ok) throw new Error(`SearXNG 回了 HTTP ${res.status}`)
  const json = await res.json()
  const results = (json.results || []).slice(0, MAX_RESULTS).map((r) => ({
    title: String(r.title || r.url || '').slice(0, 200),
    url: String(r.url || ''),
    snippet: String(r.content || r.description || '').slice(0, MAX_SNIPPET),
  }))
  if (!results.length) throw new Error('SearXNG 没搜到东西')
  return { source: 'searxng', results }
}

/** Brave Search API —— 官方接口，免费额度 2000 次/月。 */
async function searchBraveApi(key, query, signal) {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`,
    { headers: { 'X-Subscription-Token': key, Accept: 'application/json' }, signal },
  )
  if (!res.ok) throw new Error(`Brave 回了 HTTP ${res.status}`)
  const json = await res.json()
  const results = (json.web?.results || []).slice(0, MAX_RESULTS).map((r) => ({
    title: String(r.title || '').slice(0, 200),
    url: String(r.url || ''),
    snippet: String(r.description || '').slice(0, MAX_SNIPPET),
  }))
  if (!results.length) throw new Error('Brave 没搜到东西')
  return { source: 'brave', results }
}

/** Tavily —— 官方接口，免费额度 1000 次/月，本来就是给 agent 用的。 */
async function searchTavily(key, query, signal) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ api_key: key, query, max_results: MAX_RESULTS }),
    signal,
  })
  if (!res.ok) throw new Error(`Tavily 回了 HTTP ${res.status}`)
  const json = await res.json()
  const results = (json.results || []).slice(0, MAX_RESULTS).map((r) => ({
    title: String(r.title || '').slice(0, 200),
    url: String(r.url || ''),
    snippet: String(r.content || '').slice(0, MAX_SNIPPET),
  }))
  if (!results.length) throw new Error('Tavily 没搜到东西')
  return { source: 'tavily', results }
}

/**
 * 抓 Bing 的结果页 —— 不用 key 的兜底。
 *
 * 实测（2026-11）的一堆坑，都在这儿绕开了：
 *   - DuckDuckGo 的 html/lite 端点对普通客户端回 202 + anomaly（被反爬拦下）
 *   - Mojeek 回 403，Ecosia 回 403，Yahoo 回 500
 *   - Brave 的结果页 Node 抓得到，但同一个出口 IP 很快就被 429
 *   - Bing 是唯一稳的：**不能带 Accept-Language: zh-CN** ——
 *     带了它就换成另一个页面（结果不在 HTML 里，一个 b_algo 都没有）；
 *     不带就是正常的静态结果页
 *   - Node 的 fetch 默认发 accept-encoding: gzip，部分站点看见这个头直接回 429
 *
 * 页面结构哪天变了，这里就抓不到 —— 那时候配一个 SearXNG 或者官方 key 才是正经解法。
 */
async function searchBingHtml(query, signal) {
  const res = await fetch(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&setmkt=zh-CN&setlang=zh-CN&count=${MAX_RESULTS + 2}`,
    {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Encoding': 'identity',
        // ★ 别加 Accept-Language —— 加了 zh-CN，Bing 就换成另一个页面，
        //   结果一个 b_algo 都没有（实测）。市场用 URL 参数 setmkt 指定。
      },
      signal,
    },
  )
  if (!res.ok) throw new Error(`Bing 回了 HTTP ${res.status}`)
  const html = await res.text()

  const results = []
  for (const chunk of html.split('class="b_algo"').slice(1)) {
    const titleMatch = chunk.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/)
    if (!titleMatch) continue
    const title = htmlToText(titleMatch[1])
    if (!title) continue

    const hrefMatch = chunk.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"/)
    const url = hrefMatch ? decodeBingUrl(hrefMatch[1]) : ''
    if (!url.startsWith('http')) continue

    const snippetMatch = chunk.match(/<div class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)
    results.push({
      title: title.slice(0, 200),
      url,
      snippet: snippetMatch ? htmlToText(snippetMatch[1]).slice(0, MAX_SNIPPET) : '',
    })
    if (results.length >= MAX_RESULTS) break
  }
  if (!results.length) throw new Error('Bing 的结果页结构变了，抓不到结果')
  return { source: 'bing', results }
}

/**
 * Bing 把结果链接包成一层跳转（bing.com/ck/a?...&u=a1<base64>），
 * 真正的网址藏在最后那个参数里 —— 拆出来。
 */
function decodeBingUrl(href) {
  const clean = String(href).replace(/&amp;/g, '&')
  const m = clean.match(/[?&]u=a1([^&]+)/)
  if (!m) return clean
  try {
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/')
    b64 += '='.repeat((4 - (b64.length % 4)) % 4)
    const binary = atob(b64)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return clean
  }
}

/**
 * 抓 Brave 的结果页 —— Bing 也不行了才试它。
 *
 * Brave 的静态 HTML 里带着完整结果（data-type="web" 块），
 * 但同一个出口 IP 用不了多久就会被 429。
 */
async function searchBraveHtml(query, signal) {
  const res = await fetch(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Accept-Encoding': 'identity',
    },
    signal,
  })
  if (!res.ok) throw new Error(`Brave 回了 HTTP ${res.status}`)
  const html = await res.text()
  const results = []
  for (const chunk of html.split('data-type="web"').slice(1)) {
    const urlMatch = chunk.match(/href="(https?:\/\/[^"]+)"/)
    if (!urlMatch) continue
    const titleMatch = chunk.match(/class="title[^"]*"[^>]*title="([^"]*)"/)
    const snippetMatch = chunk.match(/class="content[^"]*"[^>]*>([\s\S]*?)<\/div>/)
    const title = titleMatch ? htmlToText(titleMatch[1]) : ''
    if (!title) continue
    results.push({
      title: title.slice(0, 200),
      url: urlMatch[1],
      snippet: snippetMatch ? htmlToText(snippetMatch[1]).slice(0, MAX_SNIPPET) : '',
    })
    if (results.length >= MAX_RESULTS) break
  }
  if (!results.length) throw new Error('Brave 的结果页结构变了，抓不到结果')
  return { source: 'brave', results }
}

/**
 * 搜索。
 *
 * 后端按顺序试，谁先给出结果就用谁：
 *   自建 SearXNG → Brave 官方 → Tavily 官方 → 抓 Brave 结果页
 * 全都失败就把错误原样带回去 —— 让模型知道「搜不了」，
 * 比给它一份空结果强。
 */
async function toolSearch(url, config) {
  const query = (url.searchParams.get('q') || '').trim()
  if (!query) return { ok: false, error: '缺少搜索词' }

  const backends = []
  if (config.searxngUrl) {
    backends.push(['SearXNG', (signal) => searchSearxng(config.searxngUrl, query, signal)])
  }
  if (config.braveKey) {
    backends.push(['Brave', (signal) => searchBraveApi(config.braveKey, query, signal)])
  }
  if (config.tavilyKey) {
    backends.push(['Tavily', (signal) => searchTavily(config.tavilyKey, query, signal)])
  }
  backends.push(['Bing 页面', (signal) => searchBingHtml(query, signal)])
  backends.push(['Brave 页面', (signal) => searchBraveHtml(query, signal)])

  const failures = []
  for (const [name, run] of backends) {
    try {
      const result = await withTimeout(run, TOOL_TIMEOUT_MS, name)
      return { ok: true, query, ...result }
    } catch (err) {
      failures.push(`${name}: ${err && err.message ? err.message : String(err)}`)
    }
  }
  return {
    ok: false,
    error: '搜不了 —— 几个搜索后端都没给出结果。',
    detail: failures.join(' / '),
  }
}

// ── 抓页面 ─────────────────────────────────────────────────

/**
 * 抓一个网址，取正文。
 *
 * 先用 r.jina.ai（它把页面转成干净的 markdown，还带 JS 渲染），
 * 抓不到再退回本地粗提取 —— 至少还能给模型一点东西。
 */
async function toolFetch(url, config) {
  const target = (url.searchParams.get('url') || '').trim()
  if (!target) return { ok: false, error: '缺少网址' }

  // SSRF 检查放在最前面：内网地址一步都不许走
  try {
    await assertPublicUrl(target)
  } catch (err) {
    return { ok: false, error: `这个网址不让抓：${err && err.message ? err.message : String(err)}` }
  }

  const failures = []
  try {
    const res = await withTimeout(
      (signal) =>
        fetch(`https://r.jina.ai/${target}`, {
          headers: {
            'User-Agent': BROWSER_UA,
            Accept: 'text/plain',
            'Accept-Encoding': 'identity',
          },
          signal,
        }),
      TOOL_TIMEOUT_MS,
      'Jina Reader',
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (!text.trim()) throw new Error('抓回来是空的')
    return {
      ok: true,
      url: target,
      source: 'jina',
      text: text.slice(0, MAX_FETCH_CHARS),
      truncated: text.length > MAX_FETCH_CHARS,
    }
  } catch (err) {
    failures.push(`Jina Reader: ${err && err.message ? err.message : String(err)}`)
  }

  try {
    const res = await withTimeout((signal) => fetchPublic(target, { signal }), TOOL_TIMEOUT_MS, '抓页面')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const text = htmlToText(html)
    if (!text) throw new Error('这个页面里没有能看的文字')
    return {
      ok: true,
      url: target,
      source: 'local',
      title: extractTitle(html),
      text: text.slice(0, MAX_FETCH_CHARS),
      truncated: text.length > MAX_FETCH_CHARS,
    }
  } catch (err) {
    failures.push(`本地抓取: ${err && err.message ? err.message : String(err)}`)
  }

  return { ok: false, error: '这个网址抓不到。', detail: failures.join(' / ') }
}

// ── 认字 / 读文档 ──────────────────────────────────────────
//
// 这两个要真的解析文件，跑在**本机的一个 Python 服务**里
// （proxy/doc_service.py，MarkItDown + RapidOCR）。
// 代理只负责把字节转过去 —— 四种运行时里只有 Node 系能起进程，
// 但「转发字节」这件事四种都能做。

/** 把字节转交给文档服务 */
async function forwardToDoc(path, body, url, config) {
  const base = String(config.docUrl || '').replace(/\/+$/, '')
  if (!base) return { ok: false, error: '文档服务没配（DOC_URL 是空的）' }

  // 查询参数原样带过去（filename / offset / limit）
  const query = url.search
  const target = `${base}${path}${query}`
  let res
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    })
  } catch (err) {
    return {
      ok: false,
      error: '文档服务没开 —— 认字和读文档要它在旁边跑着（npm run doc）。',
      detail: err && err.message ? err.message : String(err),
    }
  }
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { ok: false, error: '文档服务回的不是 JSON', detail: text.slice(0, 300) }
  }
  return json
}

/** 认字：图片字节，或者一个图片网址 */
async function toolOcr(request, url, config) {
  const imageUrl = (url.searchParams.get('url') || '').trim()
  let body
  if (imageUrl) {
    // 网址是模型挑的 —— 照样过一遍 SSRF 检查
    try {
      await assertPublicUrl(imageUrl)
    } catch (err) {
      return { ok: false, error: `这个网址不让抓：${err && err.message ? err.message : String(err)}` }
    }
    try {
      const res = await withTimeout((signal) => fetchPublic(imageUrl, { signal }), TOOL_TIMEOUT_MS, '抓图片')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      body = await res.arrayBuffer()
    } catch (err) {
      return { ok: false, error: '这个图片抓不到。', detail: err && err.message ? err.message : String(err) }
    }
  } else {
    body = await request.arrayBuffer()
    if (!body.byteLength) return { ok: false, error: '没有收到图片内容' }
  }
  const result = await forwardToDoc('/ocr', body, url, config)
  if (result && typeof result.text === 'string') {
    return { ok: true, text: result.text.slice(0, MAX_DOC_CHARS) }
  }
  return result
}

/** 读文档：Word / Excel / PDF / PPT，转成文字 */
async function toolDocument(request, url, config) {
  const body = await request.arrayBuffer()
  if (!body.byteLength) return { ok: false, error: '没有收到文件内容' }
  const result = await forwardToDoc('/document', body, url, config)
  if (result && typeof result.text === 'string') {
    return {
      ok: true,
      text: result.text.slice(0, HARD_DOC_CHARS),
      total: result.total,
      offset: result.offset,
      truncated: result.truncated === true,
      note: result.note,
    }
  }
  return result
}

// ── 入口 ───────────────────────────────────────────────────

/**
 * 处理一个工具请求。
 *
 * @param {Request} request
 * @param {string} path 已经归一化的路径
 * @param {URL} url 完整 URL
 * @param {object} config resolveConfig() 的结果
 * @param {Headers} cors
 * @returns {Promise<Response>}
 */
export async function handleToolRequest(request, path, url, config, cors) {
  let result
  try {
    if (path === '/tools/search') result = await toolSearch(url, config)
    else if (path === '/tools/fetch') result = await toolFetch(url, config)
    else if (path === '/tools/ocr') result = await toolOcr(request, url, config)
    else if (path === '/tools/document') result = await toolDocument(request, url, config)
    else result = { ok: false, error: '没有这个工具' }
  } catch (err) {
    result = { ok: false, error: '工具跑出错了', detail: err && err.message ? err.message : String(err) }
  }
  // 工具层面的失败也回 200 —— 它是一次「没搜到」，不是「服务坏了」。
  // 真正的服务故障（比如文档服务没起）由下面那层自己表达。
  return jsonResponse(200, result, cors)
}
