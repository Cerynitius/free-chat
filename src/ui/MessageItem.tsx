import { useEffect, useState } from 'react'
import { ArrowClockwise, Check, Copy, PencilSimple, WarningCircle } from '@phosphor-icons/react'
import type { Message, RetryNotice, TruncationKind } from '@/state/types'
import { copyText } from '@/lib/clipboard'
import { markdownToText } from '@/lib/plain'
import { CopyMenu } from './CopyMenu'
import { Markdown } from './Markdown'
import { ReasoningPanel } from './ReasoningPanel'

interface Props {
  message: Message
  streaming: boolean
  onRegenerate: () => void
  /** 用户消息：进入编辑模式（改写这一轮） */
  onEdit: (message: Message) => void
}

/** 截断的三种来由，各自怎么解释 —— 别让半个回答装作完整回答。 */
const TRUNCATION_NOTE: Record<TruncationKind, { title: string; detail: string }> = {
  length: {
    title: '输出被截断',
    detail: '达到了长度上限（max_tokens）。思考和正文共用这一个预算 —— 想太久，正文就被挤没了。',
  },
  stream: {
    title: '连接中断',
    detail: '流提前断了，没收到结束标记 —— 下面这段可能不完整。',
  },
  'content-filter': {
    title: '内容被过滤',
    detail: '上游的过滤器把这一段截掉了。',
  },
}

/**
 * 排队等重试的提示。
 *
 * 上游同时只接一个请求，被挤掉不是失败 —— 说清楚「还要等多久、第几次」，
 * 比让人盯着一句报错猜强。
 */
function QueueNotice({ notice }: { notice: RetryNotice }): React.ReactElement {
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.round((notice.at - Date.now()) / 1000)),
  )

  useEffect(() => {
    const t = window.setInterval(() => {
      const s = Math.max(0, Math.round((notice.at - Date.now()) / 1000))
      setLeft(s)
      if (s === 0) window.clearInterval(t)
    }, 500)
    return () => window.clearInterval(t)
  }, [notice.at])

  return (
    <div className="flex items-start gap-2 rounded-md border border-yellow-soft bg-yellow-soft/40 px-3 py-2.5 text-[13px] text-yellow-ink">
      <WarningCircle size={16} weight="bold" className="mt-0.5 shrink-0" />
      <div>
        <div className="font-medium">{notice.message}</div>
        <div className="mt-1 opacity-90">
          {left > 0
            ? `${left} 秒后自动重试（第 ${notice.attempt}/${notice.max} 次）`
            : `马上重试（第 ${notice.attempt}/${notice.max} 次）`}
        </div>
      </div>
    </div>
  )
}

export function MessageItem({
  message,
  streaming,
  onRegenerate,
  onEdit,
}: Props): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const onCopyQuestion = async (): Promise<void> => {
    const ok = await copyText(message.content)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  if (message.role === 'user') {
    return (
      <div className="group flex flex-col items-end gap-1.5">
        <div className="max-w-[85%] rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-[15px] leading-[1.7] text-ink-2 whitespace-pre-wrap sm:max-w-[75%]">
          {message.content}
        </div>

        <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {/* 改写这一轮：删掉后面所有对话，用新问题重新问 */}
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => onEdit(message)}
            aria-label="编辑问题"
            title="编辑问题（重写这一轮）"
          >
            <PencilSimple size={15} weight="bold" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => void onCopyQuestion()}
            aria-label={copied ? '已复制' : '复制问题'}
            title={copied ? '已复制' : '复制问题'}
          >
            {copied ? <Check size={15} weight="bold" /> : <Copy size={15} weight="bold" />}
          </button>
        </div>
      </div>
    )
  }

  const empty = !message.content.trim() && !message.reasoning.trim()
  const note = message.truncated ? TRUNCATION_NOTE[message.truncated.kind] : null

  return (
    <div className="group">
      {message.reasoning.trim() && (
        <div className="mb-3">
          <ReasoningPanel
            text={message.reasoning}
            /* 正文一开始，思考就算结束 —— 面板这时该收成一行摘要 */
            thinking={streaming && !message.content}
            elapsedMs={message.reasoningMs}
          />
        </div>
      )}

      {message.status === 'error' ? (
        <div className="flex items-start gap-2 rounded-md border border-red-soft bg-red-soft/40 px-3 py-2.5 text-[13px] text-red-ink">
          <WarningCircle size={16} weight="bold" className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">请求失败</div>
            <div className="mt-1 opacity-90">{message.error?.message ?? '未知错误'}</div>
            {/* 上游原话 —— 人话看不懂的时候，翻这句 */}
            {message.error?.detail && (
              <div className="mt-1 break-words font-mono text-[11px] opacity-70">
                {message.error.detail}
              </div>
            )}
          </div>
        </div>
      ) : message.retry ? (
        <QueueNotice notice={message.retry} />
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

      {note && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-yellow-soft bg-yellow-soft/50 px-3 py-2.5 text-[13px] text-yellow-ink">
          <WarningCircle size={16} weight="bold" className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">{note.title}</div>
            <div className="mt-1 opacity-90">{note.detail}</div>
          </div>
        </div>
      )}

      {message.status === 'aborted' && (
        <div className="mt-2 text-[12px] text-muted">（已手动停止生成）</div>
      )}

      {!streaming && message.content.trim() && (
        <div className="mt-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {/* 直接复制（纯文本）+ 复制为 Markdown */}
          <CopyMenu text={markdownToText(message.content)} markdown={message.content} label="复制回答" />
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onRegenerate}
            aria-label="重新生成"
            title="重新生成"
          >
            <ArrowClockwise size={15} weight="bold" />
          </button>
        </div>
      )}
    </div>
  )
}
