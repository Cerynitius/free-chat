import { useState } from 'react'
import { FileText, Globe, MagnifyingGlass, Scan, Wrench } from '@phosphor-icons/react'
import type { ToolCallRecord } from '@/state/types'
import { toolLabel, toolSummary } from '@/lib/tools'

interface Props {
  record: ToolCallRecord
}

/** 每个工具配一个图标 —— 一眼看出模型在干什么。 */
function ToolIcon({ name }: { name: string }): React.ReactElement {
  const props = { size: 13, weight: 'bold' as const }
  switch (name) {
    case 'web_search':
      return <MagnifyingGlass {...props} />
    case 'web_fetch':
      return <Globe {...props} />
    case 'read_file':
      return <FileText {...props} />
    case 'ocr':
      return <Scan {...props} />
    default:
      return <Wrench {...props} />
  }
}

/**
 * 一次工具调用。
 *
 * 头一行说清楚「调了什么、结果怎么样」，展开看参数和返回的原文。
 * 跑的时候显示「跑着呢…」—— 别让人对着一个不动的界面猜。
 */
export function ToolCard({ record }: Props): React.ReactElement {
  const [open, setOpen] = useState(false)

  // 参数摘要（搜索词、网址、文件名）—— 模型要查什么，界面上得看得见
  let args = ''
  try {
    const parsed = JSON.parse(record.args || '{}')
    if (parsed && typeof parsed === 'object') {
      args = toolSummary(record.name, parsed as Record<string, unknown>)
    }
  } catch {
    args = ''
  }

  const state =
    record.status === 'running'
      ? '跑着呢…'
      : record.status === 'error'
        ? '没跑成'
        : (record.summary ?? '跑完了')

  return (
    <div className="tool-card rounded-md border border-line bg-surface-2" data-status={record.status}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tool-card__head flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-canvas-2"
        aria-expanded={open}
      >
        <span className="tool-card__icon shrink-0 text-muted">
          <ToolIcon name={record.name} />
        </span>
        <span className="tool-card__label shrink-0 text-ink-2">{toolLabel(record.name)}</span>
        <span className="tool-card__args min-w-0 flex-1 truncate text-muted">{args}</span>
        <span
          className={`tool-card__state shrink-0 ${
            record.status === 'error' ? 'text-red-ink' : 'text-faint'
          }`}
        >
          {state}
        </span>
      </button>

      {open && (
        <div className="tool-card__detail border-t border-line px-2.5 py-2">
          <div className="mb-1 text-[11px] text-faint">参数</div>
          <pre className="mb-3 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink-2">
            {record.args}
          </pre>
          {record.result && (
            <>
              <div className="mb-1 text-[11px] text-faint">返回</div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink-2">
                {record.result}
              </pre>
            </>
          )}
          {record.error && (
            <div className="mt-2 text-[11px] text-red-ink">{record.error}</div>
          )}
        </div>
      )}
    </div>
  )
}
