import { useState } from 'react'
import {
  ArrowClockwise,
  Check,
  Copy,
  DownloadSimple,
  LinkSimple,
  WarningCircle,
} from '@phosphor-icons/react'
import type { Message } from '@/state/types'
import { copyText } from '@/lib/clipboard'
import { formatTokens } from '@/lib/tokens'
import { Markdown } from './Markdown'
import { ReasoningPanel } from './ReasoningPanel'

interface Props {
  message: Message
  streaming: boolean
  onRegenerate: () => void
  onShare: () => void
  onExport: () => void
}

export function MessageItem({
  message,
  streaming,
  onRegenerate,
  onShare,
  onExport,
}: Props): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const onCopy = async (): Promise<void> => {
    const ok = await copyText(message.content)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-[15px] leading-[1.6] text-ink-2 whitespace-pre-wrap sm:max-w-[75%]">
          {message.content}
        </div>
      </div>
    )
  }

  const empty = !message.content.trim() && !message.reasoning.trim()

  return (
    <div className="group">
      {message.reasoning.trim() && (
        <div className="mb-3">
          <ReasoningPanel
            text={message.reasoning}
            streaming={streaming}
            elapsedMs={message.reasoningMs}
          />
        </div>
      )}

      {message.status === 'error' ? (
        <div className="flex items-start gap-2 rounded-md border border-red-soft bg-red-soft/40 px-3 py-2.5 text-[13px] text-red-ink">
          <WarningCircle size={16} weight="bold" className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">请求失败</div>
            <div className="mt-1 opacity-90">{message.error?.message ?? '未知错误'}</div>
          </div>
        </div>
      ) : empty && streaming ? (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
          等待响应…
        </div>
      ) : (
        <div className={streaming ? 'caret' : undefined}>
          <Markdown content={message.content} />
        </div>
      )}

      {message.status === 'aborted' && (
        <div className="mt-2 text-[12px] text-muted">（已手动停止生成）</div>
      )}

      {!streaming && message.content.trim() && (
        <div className="mt-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onCopy}
            aria-label={copied ? '已复制' : '复制回答'}
            title={copied ? '已复制' : '复制回答'}
          >
            {copied ? <Check size={15} weight="bold" /> : <Copy size={15} weight="bold" />}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onRegenerate}
            aria-label="重新生成"
            title="重新生成"
          >
            <ArrowClockwise size={15} weight="bold" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onShare}
            aria-label="分享这条对话"
            title="分享这条对话"
          >
            <LinkSimple size={15} weight="bold" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onExport}
            aria-label="导出为 Markdown"
            title="导出为 Markdown"
          >
            <DownloadSimple size={15} weight="bold" />
          </button>
          {message.tokens !== undefined && (
            <span className="ml-1 font-mono text-[11px] text-faint">
              约 {formatTokens(message.tokens)} tokens
            </span>
          )}
        </div>
      )}
    </div>
  )
}
