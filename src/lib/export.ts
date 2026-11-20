import type { Conversation } from '@/state/types'
import { formatTime, stamp } from './date'

/**
 * 导出会话为 Markdown。
 * 思考过程放进 <details>，正文原样保留 —— 导出的文件在别的 Markdown 阅读器里也能看。
 */
export function conversationToMarkdown(conv: Conversation): string {
  const lines: string[] = [`# ${conv.title || '未命名会话'}`, '']

  for (const m of conv.messages) {
    if (m.role === 'system') continue
    const who = m.role === 'user' ? '我' : '助手'
    lines.push(`## ${who} · ${formatTime(m.createdAt)}`)
    lines.push('')

    if (m.reasoning.trim()) {
      lines.push('<details>')
      lines.push('<summary>思考过程</summary>')
      lines.push('')
      lines.push(m.reasoning.trim())
      lines.push('')
      lines.push('</details>')
      lines.push('')
    }

    if (m.content.trim()) {
      lines.push(m.content.trim())
      lines.push('')
    }

    if (m.status === 'aborted') {
      lines.push('> （生成已被手动停止）')
      lines.push('')
    }
  }

  return lines.join('\n')
}

export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportConversation(conv: Conversation): void {
  downloadMarkdown(`hippocrenes-${stamp()}.md`, conversationToMarkdown(conv))
}
