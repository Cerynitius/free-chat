import { useEffect, useRef, useState } from 'react'
import { PaperPlaneRight, Stop } from '@phosphor-icons/react'
import { EffortPicker } from './EffortPicker'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  effort: string
  onEffortChange: (v: 'off' | 'none' | 'low' | 'high' | 'max') => void
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  effort,
  onEffortChange,
}: Props): React.ReactElement {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const [focused, setFocused] = useState(false)

  // 自增高
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [value])

  // 触屏设备上 Enter 应该换行 —— 物理键盘才用 Enter 发送
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter') return
    if (e.shiftKey || coarse || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (!streaming && value.trim()) onSend()
  }

  return (
    <div className="border-t border-line bg-canvas px-3 pb-3 pt-2 sm:px-6 sm:pb-5">
      <div className="mx-auto max-w-3xl">
        <div
          className={`rounded-lg border bg-surface transition-colors ${
            focused ? 'border-ink' : 'border-line'
          }`}
        >
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            placeholder={streaming ? '正在生成…' : '说点什么…（Enter 发送，Shift+Enter 换行）'}
            className="max-h-[220px] w-full resize-none bg-transparent px-3.5 py-3 text-[15px] leading-[1.6] text-ink outline-none placeholder:text-faint"
            aria-label="输入消息"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <EffortPicker value={effort} onChange={onEffortChange} />
            </div>
            {streaming ? (
              <button type="button" className="btn btn-icon" onClick={onStop} aria-label="停止生成">
                <Stop size={16} weight="fill" />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-icon"
                onClick={onSend}
                disabled={!value.trim()}
                aria-label="发送"
              >
                <PaperPlaneRight size={16} weight="fill" />
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
