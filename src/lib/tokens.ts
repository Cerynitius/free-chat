/**
 * 客户端 token 估算。
 *
 * 服务端不返 usage（实测所有 SSE 分片里都没有 usage 字段），所以只能估：
 *   中文 约 1.6 字 / token；拉丁文 约 4 字符 / token。
 *
 * UI 上必须写「估算」，别装成精确值。
 */
const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/

export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let rest = 0
  for (const ch of text) {
    if (CJK.test(ch)) cjk++
    else rest++
  }
  return Math.ceil(cjk / 1.6 + rest / 4)
}

/** 一条消息（含思考过程）的估算 token 数 */
export function estimateMessageTokens(content: string, reasoning = ''): number {
  return estimateTokens(content) + estimateTokens(reasoning)
}

/** 格式化成「1.2k」这样的小体积文本 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}
