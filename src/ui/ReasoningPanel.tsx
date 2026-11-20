import { useState } from 'react'
import { Brain, CaretDown, CaretRight } from '@phosphor-icons/react'

interface Props {
  text: string
  streaming: boolean
  elapsedMs?: number
}

export function ReasoningPanel({ text, streaming, elapsedMs }: Props): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  if (!text.trim()) return null

  const label = streaming
    ? '正在思考…'
    : elapsedMs !== undefined
      ? `已思考 ${(elapsedMs / 1000).toFixed(1)} 秒`
      : '思考过程'

  return (
    <div className="reasoning">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-muted transition-colors hover:text-ink"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <CaretDown size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
        <Brain size={15} weight="bold" />
        <span>{label}</span>
        {streaming && (
          <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink" />
        )}
      </button>
      {open && <div className="reasoning__body">{text}</div>}
    </div>
  )
}
