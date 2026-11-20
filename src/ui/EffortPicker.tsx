import { useEffect, useRef, useState } from 'react'
import { CaretDown, Check } from '@phosphor-icons/react'
import type { ReasoningEffort } from '@/state/types'

const OPTIONS: { value: ReasoningEffort; label: string; hint: string }[] = [
  { value: 'off', label: '关闭', hint: '不思考' },
  { value: 'none', label: '无', hint: '不思考' },
  { value: 'low', label: '低', hint: '轻量' },
  { value: 'high', label: '高', hint: '完整推理' },
  { value: 'max', label: '极限', hint: '最长，最慢' },
]

interface Props {
  value: string
  onChange: (v: ReasoningEffort) => void
}

export function EffortPicker({ value, onChange }: Props): React.ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = OPTIONS.find((o) => o.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="tag cursor-pointer normal-case"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        思考 · {current?.label ?? value}
        <CaretDown size={11} weight="bold" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-1 w-56 rounded-md border border-line bg-surface p-1 shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
        >
          {OPTIONS.map((o) => {
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2 rounded-xs px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                <span className="mt-0.5 w-3 shrink-0">
                  {o.value === value && <Check size={12} weight="bold" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-[13px] text-ink">{o.label}</span>
                  <span className="block text-[11px] text-muted">{o.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
