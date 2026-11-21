#!/usr/bin/env node
/**
 * Node 版 runner —— 本地开发与自建部署。
 *
 * 零依赖：只用 node: 内置模块，加上 Node 18+ 自带的全局 fetch/Request/Response。
 * 核心逻辑在 handler.js 里，和 Cloudflare Workers / Deno Deploy / Vercel Edge
 * 共用同一份，避免「本地能跑、线上行为不一样」这种事。
 *
 * 用法：
 *   API_KEY=xxx node server.mjs
 *   node server.mjs --port 9000 --upstream https://example.com
 */
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { DEFAULT_UPSTREAM, handleRequest } from './handler.js'

const argv = process.argv.slice(2)

/** 取 --flag value 或 --flag=value 两种写法里的值。 */
function readArg(name) {
  const withEq = argv.find((arg) => arg.startsWith(`${name}=`))
  if (withEq) return withEq.slice(name.length + 1)
  const index = argv.indexOf(name)
  if (index !== -1 && index + 1 < argv.length) return argv[index + 1]
  return undefined
}

const port = Number(readArg('--port') || process.env.PORT || 8787)
const host = readArg('--host') || process.env.HOST || '127.0.0.1'
const upstream = String(readArg('--upstream') || process.env.UPSTREAM || DEFAULT_UPSTREAM)
  .trim()
  .replace(/\/+$/, '')
const apiKey = String(process.env.API_KEY || '').trim()
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '').trim()

// handler.js 收到的 env —— 各平台用不同方式注入同一个对象，这里显式组装
const env = {
  UPSTREAM: upstream,
  API_KEY: apiKey,
  ALLOWED_ORIGINS: allowedOrigins,
  // 工具那一套
  SEARXNG_URL: String(process.env.SEARXNG_URL || '').trim(),
  BRAVE_API_KEY: String(process.env.BRAVE_API_KEY || '').trim(),
  TAVILY_API_KEY: String(process.env.TAVILY_API_KEY || '').trim(),
  DOC_URL: String(process.env.DOC_URL || 'http://127.0.0.1:8788').trim(),
}

/**
 * 代理不许因为一个没接住的 promise 整个死掉。
 *
 * 这个进程在生产里是全站唯一的入口 —— 它一挂，站点就暗了。
 * 所以这里把没接住的错误记下来，继续跑。
 */
process.on('unhandledRejection', (reason) => {
  console.error('[proxy] 有个 promise 没人接（已忽略，进程继续跑）：', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[proxy] 未捕获的异常（已忽略，进程继续跑）：', err)
})

/** Node 的 IncomingMessage 转成 Web 的 Request。 */
function toWebRequest(req) {
  const hostHeader = req.headers.host || 'localhost'
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else {
      headers.set(name, value)
    }
  }

  const init = { method: req.method, headers }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // IncomingMessage 是 Node 流，包成 Web 的 ReadableStream 才能原样接过去
    init.body = Readable.toWeb(req)
    init.duplex = 'half'
  }
  return new Request(`http://${hostHeader}${req.url}`, init)
}

/**
 * Web 的 Response 转回 Node 的 ServerResponse。
 *
 * 头先写出去（flushHeaders），然后逐块 res.write() —— 绝不能 await res.text()
 * 之类把整个响应读完再一次性吐出去，那样 SSE 的流式就没了。
 */
async function sendWebResponse(res, response) {
  const headers = {}
  for (const [name, value] of response.headers) headers[name] = value
  res.writeHead(response.status, headers)
  res.flushHeaders()

  if (!response.body) {
    res.end()
    return
  }
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
  } finally {
    res.end()
  }
}

const server = createServer((req, res) => {
  ;(async () => {
    try {
      const request = toWebRequest(req)
      const response = await handleRequest(request, env)
      await sendWebResponse(res, response)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      }
      res.end(
        JSON.stringify({ error: { type: 'proxy_error', message } }, null, 2),
      )
    }
  })()
})

server.listen(port, host, () => {
  const keyState = apiKey ? '已配置（浏览器拿不到）' : '未配置（透传客户端 Authorization）'
  const originState = allowedOrigins || '*（放行全部）'
  console.log(
    `[proxy] http://${host}:${port} -> ${upstream}  key=${keyState}  allowedOrigins=${originState}`,
  )
  console.log(`[proxy] 自检：curl http://${host}:${port}/__ping`)
})
