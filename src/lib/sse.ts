/**
 * SSE 帧解析。
 *
 * 为什么不能用 EventSource：它只能发 GET、不能带 body —— 而聊天请求必须带
 * Authorization 头和 JSON body。所以只能用 fetch + ReadableStream 自己拆帧。
 *
 * 要处理两种切分：
 *   a) 一行被 TCP 切成两半 → 用残余缓冲 + TextDecoder 的 stream 模式
 *   b) 一帧折成多行（标准 SSE 允许 data 字段折行）→ 用「能否解析成完整 JSON」判断
 */
import { ApiError } from './api'

/**
 * 一段文本是不是**完整**的 JSON。
 * 用来判断「上一帧是否已经收完」—— 能 parse 就说明收完了，可以先吐出去。
 */
function isCompleteJson(s: string): boolean {
  const t = s.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

/**
 * 把 fetch 的响应流拆成 SSE 帧，只取 data 字段的内容。
 * 逐帧 yield，调用方拿到一帧就能渲染一帧。
 */
export async function* readSSE(res: Response): AsyncGenerator<string> {
  if (!res.body) {
    throw new ApiError('响应没有 body —— 多半是中间层把流缓冲掉了', 'parse')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = '' // 还没凑够一行的残余
  let data = '' // 当前帧的 data 缓冲

  const take = (): string | null => {
    if (!data) return null
    const out = data
    data = ''
    return out
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)

        // 空行 = 一帧结束
        if (line === '') {
          const frame = take()
          if (frame !== null) yield frame
          continue
        }

        // 注释行 / 心跳
        if (line.startsWith(':')) continue

        const ci = line.indexOf(':')
        if (ci === -1) continue
        const field = line.slice(0, ci)
        if (field !== 'data') continue

        let val = line.slice(ci + 1)
        if (val.startsWith(' ')) val = val.slice(1)

        // 上一帧若已是完整 JSON，先吐出去，再把新行当成新帧的开头
        if (data && isCompleteJson(data)) {
          const frame = take()
          if (frame !== null) yield frame
        }
        data = data ? data + '\n' + val : val
      }
    }

    // 流结束：把解码器里剩下的字节冲出来，再收最后一帧
    buf += decoder.decode()
    const tail = buf.replace(/\r$/, '')
    if (tail.startsWith('data:')) {
      let val = tail.slice(5).trim()
      if (val.startsWith(' ')) val = val.slice(1)
      if (data && isCompleteJson(data)) {
        const frame = take()
        if (frame !== null) yield frame
      }
      data = data ? data + '\n' + val : val
    }
    const last = take()
    if (last !== null) yield last
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* 已经断了就算了 */
    }
  }
}
