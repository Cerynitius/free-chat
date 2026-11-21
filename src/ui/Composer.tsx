import { useEffect, useRef, useState } from 'react'
import { PaperPlaneRight, PencilSimple, Stop, X } from '@phosphor-icons/react'
import { EffortPicker } from './EffortPicker'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  effort: string
  onEffortChange: (v: 'off' | 'none' | 'low' | 'high' | 'max') => void
  /** 正在改写某条消息（发出去 = 替换掉那一轮） */
  editing: boolean
  onCancelEdit: () => void
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  effort,
  onEffortChange,
  editing,
  onCancelEdit,
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

  // 进编辑模式 ⇒ 光标直接落到输入框里，接着就能改
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

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
          {editing && (
            <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] text-muted">
              <PencilSimple size={12} weight="bold" className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                正在改写这一轮 —— 发出去会替换掉它后面的全部对话
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-icon shrink-0"
                onClick={onCancelEdit}
                aria-label="取消编辑"
                title="取消编辑"
              >
                <X size={13} weight="bold" />
              </button>
            </div>
          )}

          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            placeholder={
              streaming ? '正在生成…' : editing ? '改完直接发 —— 这一轮会被替换' : '说点什么…（Enter 发送，Shift+Enter 换行）'
            }
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
                aria-label={editing ? '改写并发送' : '发送'}
                title={editing ? '改写并发送' : '发送'}
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
