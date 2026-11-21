/**
 * 会话搜索：标题 + 全部消息正文，在本地内存里扫一遍。
 *
 * 几百条会话、每条几十 KB，扫一遍是毫秒级 —— 不值得为此建索引。
 * 多个词用空格隔开：每个词都要出现（出现在不同消息里也算）。
 */
import type { Conversation, Message } from '@/state/types'
import { markdownToText } from './plain'

/** 消息的纯文本（去掉 Markdown 记号）按消息对象缓存 —— 消息不变就不重算 */
const plainCache = new WeakMap<Message, string>()
function plain(m: Message): string {
  let t = plainCache.get(m)
  if (t === undefined) {
    t = markdownToText(m.content)
    plainCache.set(m, t)
  }
  return t
}

export interface SearchHit {
  conv: Conversation
  /** 命中处前后的一小段原文；只命中标题时为空 */
  snippet: string
  /** snippet 里要高亮的区间 [start, end) */
  marks: [number, number][]
}

const CONTEXT = 18

export function searchConversations(list: Conversation[], query: string): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const hits: SearchHit[] = []
  for (const conv of list) {
    const title = conv.title.toLowerCase()
    const texts = conv.messages.map(plain)
    const lower = texts.map((t) => t.toLowerCase())
    const all = terms.every((t) => title.includes(t) || lower.some((x) => x.includes(t)))
    if (!all) continue
    // 片段：取第一个在正文里出现的词，截它前后各一小段
    let snippet = ''
    let marks: [number, number][] = []
    for (let i = 0; i < lower.length && !snippet; i++) {
      const t = terms.find((term) => lower[i].includes(term))
      if (!t) continue
      const at = lower[i].indexOf(t)
      const from = Math.max(0, at - CONTEXT)
      const to = Math.min(texts[i].length, at + t.length + CONTEXT * 2)
      const raw = texts[i].slice(from, to).replace(/\s+/g, ' ')
      snippet = (from > 0 ? '…' : '') + raw + (to < texts[i].length ? '…' : '')
      const low = snippet.toLowerCase()
      marks = []
      for (const term of terms) {
        let k = low.indexOf(term)
        while (k >= 0) {
          marks.push([k, k + term.length])
          k = low.indexOf(term, k + term.length)
        }
      }
      marks.sort((a, b) => a[0] - b[0])
    }
    hits.push({ conv, snippet, marks })
  }
  return hits.sort((a, b) => b.conv.updatedAt - a.conv.updatedAt)
}

/** 把 snippet 按高亮区间切段（区间可能重叠，合并后再切） */
export function splitMarks(text: string, marks: [number, number][]): { text: string; hit: boolean }[] {
  const merged: [number, number][] = []
  for (const [s, e] of marks) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  const out: { text: string; hit: boolean }[] = []
  let pos = 0
  for (const [s, e] of merged) {
    if (s > pos) out.push({ text: text.slice(pos, s), hit: false })
    out.push({ text: text.slice(s, e), hit: true })
    pos = e
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false })
  return out
}
