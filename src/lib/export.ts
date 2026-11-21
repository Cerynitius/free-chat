/**
 * 导出 / 导入。
 *
 * 数据只在这个浏览器里 —— 换电脑、清缓存之前，导出一份备份是唯一的保险。
 *   单条会话 → Markdown（给人看、贴到别处）
 *   全部     → JSON（能原样导回来）
 */
import type { Conversation, Message, Settings } from '@/state/types'

const APP = 'free-chat'
const FORMAT = 1

export interface Backup {
  app: typeof APP
  format: number
  exportedAt: string
  settings?: Partial<Settings>
  conversations: Conversation[]
}

function stamp(t: number): string {
  const d = new Date(t)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 文件名里不能有的字符换掉，太长的截断 */
export function safeFileName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').trim().slice(0, 60)
  return s || '未命名会话'
}

function messageToMarkdown(m: Message, withReasoning: boolean): string {
  const head = m.role === 'user' ? '### 我' : '### 助手'
  const parts = [`${head}  \n<sub>${stamp(m.createdAt)}</sub>`]
  if (m.role === 'user' && m.attachments?.length) parts.push(`> 附件：${m.attachments.join('、')}`)
  if (withReasoning && m.reasoning.trim()) {
    parts.push(`<details><summary>思考过程</summary>\n\n${m.reasoning.trim()}\n\n</details>`)
  }
  if (m.tools?.length) {
    parts.push(m.tools.map((t) => `> 🔧 ${t.name}${t.summary ? `：${t.summary}` : ''}`).join('\n'))
  }
  parts.push(m.content.trim() || (m.status === 'error' ? `*（出错：${m.error?.message ?? '未知错误'}）*` : '*（空）*'))
  return parts.join('\n\n')
}

export function conversationToMarkdown(c: Conversation, withReasoning: boolean): string {
  const title = c.title || '未命名会话'
  const body = c.messages
    .filter((m) => m.role !== 'system')
    .map((m) => messageToMarkdown(m, withReasoning))
    .join('\n\n---\n\n')
  return `# ${title}\n\n<sub>创建于 ${stamp(c.createdAt)} · 最后更新 ${stamp(c.updatedAt)}</sub>\n\n${body}\n`
}

export function makeBackup(conversations: Conversation[], settings: Settings): Backup {
  return {
    app: APP,
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    settings,
    conversations: conversations
      .filter((c) => c.messages.length > 0 || c.pinned)
      .map((c) => ({
        ...c,
        // 正在生成的那条按「中断」存 —— 导回来时不能显示成还在生成
        messages: c.messages.map((m) =>
          m.status === 'streaming' ? { ...m, status: 'aborted' as const, retry: undefined } : m,
        ),
      })),
  }
}

/** 下载一个文本文件 */
export function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function isMessage(m: unknown): m is Message {
  if (!m || typeof m !== 'object') return false
  const x = m as Record<string, unknown>
  return (
    typeof x.id === 'string' &&
    (x.role === 'user' || x.role === 'assistant' || x.role === 'system') &&
    typeof x.content === 'string'
  )
}

/**
 * 读一个备份文件。
 *
 * 只认本应用导出的格式；每条会话、每条消息都过一遍形状检查，
 * 缺的字段补上默认值 —— 坏掉的条目跳过，不让一条坏数据拖垮整个导入。
 */
export function parseBackup(text: string): { conversations: Conversation[]; skipped: number } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('不是有效的 JSON 文件')
  }
  const raw =
    data && typeof data === 'object' && Array.isArray((data as Backup).conversations)
      ? (data as Backup).conversations
      : Array.isArray(data)
        ? (data as unknown[])
        : null
  if (!raw) throw new Error('文件里没有会话列表（不是本应用导出的备份？）')
  const out: Conversation[] = []
  let skipped = 0
  for (const c of raw as unknown[]) {
    const x = (c ?? {}) as Record<string, unknown>
    if (typeof x.id !== 'string' || !Array.isArray(x.messages)) {
      skipped += 1
      continue
    }
    const messages = (x.messages as unknown[]).filter(isMessage).map((m) => ({
      ...m,
      reasoning: typeof m.reasoning === 'string' ? m.reasoning : '',
      createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
      status: m.status === 'streaming' ? ('aborted' as const) : (m.status ?? 'complete'),
      retry: undefined,
    }))
    const now = Date.now()
    out.push({
      id: x.id,
      title: typeof x.title === 'string' ? x.title : '',
      pinned: x.pinned === true,
      titleLocked: x.titleLocked === true,
      messages,
      createdAt: typeof x.createdAt === 'number' ? x.createdAt : now,
      updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : now,
    })
  }
  return { conversations: out, skipped }
}

export function backupFileName(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `free-chat-备份-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
}

export function formatBytes(n: number | null): string {
  if (n === null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}
