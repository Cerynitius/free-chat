/**
 * 工具登记表。
 *
 * 每个工具三样东西：给模型看的名字和说明（JSON schema）、
 * 真正干活的函数、以及一句给界面看的摘要。
 *
 * 工具分两处跑：
 *   服务端 —— 搜索、抓网页、认字、读文档（走代理的 /tools/*）
 *   浏览器 —— 读用户上传的文本文件（压根不离开本机）
 *
 * 跑在服务端的那些，浏览器自己抓不了：搜索引擎和站点都不给 CORS 头。
 */

import { endpoint } from './api'
import { findAttachment, listAttachments, type Attachment } from './attachments'
import type { WireToolCall } from '@/state/types'

/** 发给上游的工具定义（协议里的形状） */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** 一次工具执行的结果 */
export interface ToolOutcome {
  /** 回给模型的内容 */
  content: string
  /** 界面上显示的一句话 */
  summary: string
  /** 成没成 */
  ok: boolean
}

/** 工具自己知道怎么干，但需要外部提供的东西走 context */
export interface ToolContext {
  signal: AbortSignal
}

/** 内部用的工具定义 */
interface Tool extends ToolDefinition {
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>
}

/** 调代理上的工具接口 */
async function callProxy(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${endpoint()}${path}`, init)
  if (!res.ok) {
    throw new Error(`工具接口回了 HTTP ${res.status}`)
  }
  const json = (await res.json()) as Record<string, unknown>
  return json
}

/** 读一段文本，标上行号 */
function numberedLines(text: string, offset: number, limit: number): string {
  const lines = text.split('\n')
  const slice = lines.slice(offset, offset + limit)
  const body = slice.map((line, i) => `${offset + i + 1}: ${line}`).join('\n')
  return `第 ${offset + 1}–${offset + slice.length} 行（全文共 ${lines.length} 行）：\n${body}`
}

/** 把一个附件的字节发给文档服务 */
async function postFile(
  path: string,
  attachment: Attachment,
  extra: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const blob = attachment.blob
  if (!blob) throw new Error('这个附件没有内容')
  const params = new URLSearchParams({ filename: attachment.name, ...extra })
  return callProxy(`${path}?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
  })
}

/**
 * 工具失败时的说法。
 *
 * 只给人话 —— 服务端的细节（Python 堆栈、上游原话）**不进模型的上下文**：
 * 那玩意儿对模型没用，只会把提示词撑大、把回答搅浑。细节进控制台。
 */
function failure(prefix: string, data: Record<string, unknown>, summary: string): ToolOutcome {
  if (data.detail) console.warn('[tools] 失败细节：', data.detail)
  return {
    ok: false,
    content: `${prefix}${String(data.error ?? '不知道什么原因')}`,
    summary,
  }
}

// ── 四个工具 ───────────────────────────────────────────────

const webSearch: Tool = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      '搜索网页。返回若干条结果的标题、链接和摘要。' +
      '需要网上的最新信息、或者你不确定的事情时用它；' +
      '凭自己的记忆回答会更容易过时。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索词' },
      },
      required: ['query'],
    },
  },
  async run(args) {
    const query = String(args.query ?? '').trim()
    if (!query) return { ok: false, content: '没有搜索词。', summary: '没有搜索词' }
    const data = await callProxy(`/tools/search?q=${encodeURIComponent(query)}`)
    if (data.ok !== true) {
      return failure('搜不了：', data, '搜不了')
    }
    const results = (data.results as { title: string; url: string; snippet: string }[]) ?? []
    if (!results.length) {
      return { ok: false, content: '搜了，但一条结果都没有。', summary: '没有结果' }
    }
    const body = results
      .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`)
      .join('\n\n')
    return {
      ok: true,
      content: `搜索「${query}」的结果（来自 ${String(data.source ?? '搜索')}）：\n\n${body}`,
      summary: `${results.length} 条结果`,
    }
  },
}

const webFetch: Tool = {
  type: 'function',
  function: {
    name: 'web_fetch',
    description:
      '抓一个网址的正文，返回纯文字（markdown）。' +
      '搜索结果只有摘要，想看全文就用它。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整的网址，http 或 https 开头' },
      },
      required: ['url'],
    },
  },
  async run(args) {
    const url = String(args.url ?? '').trim()
    if (!url) return { ok: false, content: '没有网址。', summary: '没有网址' }
    const data = await callProxy(`/tools/fetch?url=${encodeURIComponent(url)}`)
    if (data.ok !== true) {
      return failure('抓不到：', data, '抓不到')
    }
    const text = String(data.text ?? '')
    const title = String(data.title ?? '')
    return {
      ok: true,
      content: `网址：${url}${title ? `\n标题：${title}` : ''}\n\n${text}`,
      summary: `${text.length} 字`,
    }
  },
}

const readFile: Tool = {
  type: 'function',
  function: {
    name: 'read_file',
    description:
      '读一个附件。文本文件（.txt/.md/.json/代码等）直接读出内容；' +
      'PDF、Word、Excel、PPT 会转成文字；图片会走认字。' +
      'offset/limit 对文本文件是行号，对文档是字符数 —— 不给就从头读。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '附件的文件名' },
        offset: { type: 'integer', description: '从哪儿开始（文本=行号，文档=字符）' },
        limit: { type: 'integer', description: '读多少（文本=行数，文档=字符）' },
      },
      required: ['path'],
    },
  },
  async run(args) {
    const path = String(args.path ?? '').trim()
    const offset = Math.max(0, Number(args.offset ?? 0) || 0)
    const limit = Math.max(1, Number(args.limit ?? 400) || 400)
    if (!path) return { ok: false, content: '没有文件名。', summary: '没有文件名' }

    const attachment = findAttachment(path)
    if (!attachment) {
      const names = '（当前附件：' + (listNames() || '无') + '）'
      return {
        ok: false,
        content: `附件里没有「${path}」${names}。刷新页面后附件就没了。`,
        summary: '没有这个文件',
      }
    }

    // 文本：本地读，压根不发给服务器
    if (attachment.kind === 'text') {
      const text = attachment.text ?? ''
      return {
        ok: true,
        content: `文件 ${attachment.name}\n${numberedLines(text, offset, limit)}`,
        summary: `${Math.min(limit, text.split('\n').length - offset)} 行`,
      }
    }

    // 图片：走认字
    if (attachment.kind === 'image') {
      const data = await postFile('/tools/ocr', attachment)
      if (data.ok !== true) {
        return {
          ok: false,
          content: `认不出这张图：${String(data.error ?? '不知道什么原因')}`,
          summary: '认字失败',
        }
      }
      const text = String(data.text ?? '')
      return {
        ok: true,
        content: `图片 ${attachment.name} 里的文字：\n${text}`,
        summary: text ? `${text.length} 字` : '没认出字',
      }
    }

    // 文档：转成文字
    const data = await postFile('/tools/document', attachment, {
      offset: String(offset),
      limit: String(limit),
    })
    if (data.ok !== true) {
      return failure('读不了这个文件：', data, '读不了')
    }
    const text = String(data.text ?? '')
    const total = Number(data.total ?? text.length)
    const note = data.note ? `\n\n（${String(data.note)}）` : ''
    const more = data.truncated === true ? `\n\n（文件还有内容没读到，接着用 offset=${offset + text.length} 读。）` : ''
    return {
      ok: true,
      content: `文件 ${attachment.name}（共 ${total} 字，读了第 ${offset + 1}–${offset + text.length} 字）：\n${text}${note}${more}`,
      summary: `${text.length} 字`,
    }
  },
}

const ocr: Tool = {
  type: 'function',
  function: {
    name: 'ocr',
    description:
      '把图片里的字认出来。给附件里的图片用 path，给网上的图片用 url。' +
      '中英文都认，认不准的可能会错。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '附件里的图片文件名' },
        url: { type: 'string', description: '图片网址（http/https）' },
      },
    },
  },
  async run(args) {
    const path = String(args.path ?? '').trim()
    const url = String(args.url ?? '').trim()

    if (url) {
      const data = await callProxy(`/tools/ocr?url=${encodeURIComponent(url)}`)
      if (data.ok !== true) {
        return {
          ok: false,
          content: `认不出这张图：${String(data.error ?? '不知道什么原因')}`,
          summary: '认字失败',
        }
      }
      const text = String(data.text ?? '')
      return {
        ok: true,
        content: `图片 ${url} 里的文字：\n${text}`,
        summary: text ? `${text.length} 字` : '没认出字',
      }
    }

    if (!path) return { ok: false, content: '既没有文件名也没有网址。', summary: '没给图片' }
    const attachment = findAttachment(path)
    if (!attachment) {
      const names = '（当前附件：' + (listNames() || '无') + '）'
      return {
        ok: false,
        content: `附件里没有「${path}」${names}。刷新页面后附件就没了。`,
        summary: '没有这个文件',
      }
    }
    if (attachment.kind !== 'image') {
      return { ok: false, content: `${attachment.name} 不是图片。`, summary: '不是图片' }
    }
    const data = await postFile('/tools/ocr', attachment)
    if (data.ok !== true) {
      return {
        ok: false,
        content: `认不出这张图：${String(data.error ?? '不知道什么原因')}`,
        summary: '认字失败',
      }
    }
    const text = String(data.text ?? '')
    return {
      ok: true,
      content: `图片 ${attachment.name} 里的文字：\n${text}`,
      summary: text ? `${text.length} 字` : '没认出字',
    }
  },
}

/** 附上当前有哪些附件 —— 找不到文件时给模型一点线索 */
function listNames(): string {
  return listAttachments()
    .map((a) => a.name)
    .join('、')
}

// ── 登记表 ─────────────────────────────────────────────────

const TOOLS: Tool[] = [webSearch, webFetch, readFile, ocr]

/** 发给上游的 tools 数组 */
export function toolDefinitions(): ToolDefinition[] {
  return TOOLS.map(({ type, function: fn }) => ({ type, function: fn }))
}

/** 工具名字 → 界面上的中文标签 */
const LABELS: Record<string, string> = {
  web_search: '搜索网页',
  web_fetch: '抓取网页',
  read_file: '读文件',
  ocr: '认字',
}

export function toolLabel(name: string): string {
  return LABELS[name] ?? name
}

/** 工具调用 → 一句话摘要，界面上显示用 */
export function toolSummary(name: string, args: Record<string, unknown>): string {
  const text = (key: string): string => {
    const value = args[key]
    return typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value)
  }
  if (name === 'web_search') return text('query')
  if (name === 'web_fetch') return text('url')
  if (name === 'read_file') return text('path')
  if (name === 'ocr') return text('path') || text('url')
  return ''
}

/**
 * 执行一次工具调用。
 *
 * 出错不抛 —— 工具失败也是回答的一部分：
 * 把失败原样回给模型，它自己会换个说法告诉用户。
 */
export async function runTool(
  call: WireToolCall,
  ctx: ToolContext,
): Promise<{ ok: boolean; content: string; summary: string }> {
  const name = call.function.name
  const tool = TOOLS.find((t) => t.function.name === name)
  if (!tool) {
    return {
      ok: false,
      content: `没有叫「${name}」这个工具。`,
      summary: '没有这个工具',
    }
  }

  let args: Record<string, unknown> = {}
  try {
    const raw = call.function.arguments || '{}'
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>
  } catch {
    return {
      ok: false,
      content: `参数不是合法的 JSON：${call.function.arguments}`,
      summary: '参数不对',
    }
  }

  try {
    return await tool.run(args, ctx)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, content: `工具跑出错了：${message}`, summary: '跑出错' }
  }
}
