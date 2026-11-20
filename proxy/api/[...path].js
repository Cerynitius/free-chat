/**
 * Vercel（Node.js 运行时）入口 —— catch-all。
 *
 * 用 Node 运行时而不是 Edge：Edge 是边缘节点，Node 是真容器 ——
 * 只有真容器才能稳定地直连裸 IP 的非标准端口（上游只有 182.92.245.176:1920
 * 这个入口，没有域名，证书也只有 IP SAN）。
 *
 * 路径怎么还原：vercel.json 里把 `/(.*)` 改写到 `/api/:path*`，
 * 于是 /v1/models → /api/v1/models，函数里 req.url 就是 /api/v1/models，
 * 去掉 /api 前缀就还原成上游的真实路径。
 * （Vercel 的路由顺序是「先查文件系统、再套 rewrites」，所以直接命中
 *   /api/... 的请求不会二次改写，req.url 形状一致。）
 */
import { handleRequest } from '../handler.js'

// maxDuration 是这次响应能活多久的上限 —— 上游思考久了整条流要跑好几分钟，
// 60 秒会把它拦腰砍断（而且砍断之后前端看不出来，只当生成正常结束）。
// Hobby 套餐本身就把函数时长钉在 60 秒，Pro 才吃这个值。
export const config = { runtime: 'nodejs', maxDuration: 300 }

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)

    // 去掉 rewrite 挂上的 /api 前缀，还原成上游路径
    let path = url.pathname
    if (path === '/api' || path.startsWith('/api/')) path = path.slice(4) || '/'

    // 请求体很小（一个 JSON），直接读成 Buffer —— 上游不介意我们缓冲请求体
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? Buffer.concat(chunks) : undefined

    const request = new Request(`http://${req.headers.host ?? 'localhost'}${path}${url.search}`, {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    })

    const response = await handleRequest(request, process.env)

    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))

    if (!response.body) {
      res.end()
      return
    }

    // ★ 逐块回传 —— 上游是 SSE，攒成整段再吐就没有流式了
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
    res.end()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!res.headersSent) res.statusCode = 500
    res.end(JSON.stringify({ error: { type: 'proxy_error', message } }))
  }
}