/**
 * Vercel (Node.js runtime) 入口。
 *
 * 用 Node 运行时而不是 Edge：Edge 是边缘节点，Node 是真容器 ——
 * 只有真容器才能稳定地直连裸 IP 的非标准端口（上游只有 182.92.245.176:1920 这个入口，
 * 没有域名，证书也只有 IP SAN）。
 *
 * 关键：响应必须**流式**回传。上游是 SSE，攒成整段再吐出去就没有流式了。
 */
import { handleRequest } from '../handler.js'

export const config = { runtime: 'nodejs', maxDuration: 60 }

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)

    // 请求体很小（一个 JSON），直接读成 Buffer —— 上游不介意我们缓冲请求体
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? Buffer.concat(chunks) : undefined

    const request = new Request(url, {
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