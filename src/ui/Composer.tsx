import { useEffect, useRef, useState } from 'react'
import { Paperclip, PaperPlaneRight, PencilSimple, Stop, Wrench, X } from '@phosphor-icons/react'
import { EffortPicker } from './EffortPicker'
import { formatSize, type Attachment } from '@/lib/attachments'
import type { SendKey } from '@/state/types'
import { isMac, modKey } from './shortcuts'

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
  /** 挂着的附件 */
  attachments: Attachment[]
  onFiles: (files: FileList | null) => void
  onRemoveAttachment: (id: string) => void
  /** 工具开不开 */
  toolsEnabled: boolean
  onToolsChange: (v: boolean) => void
  /** Enter 发送，还是 Ctrl/⌘+Enter 发送 */
  sendKey: SendKey
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
  attachments,
  onFiles,
  onRemoveAttachment,
  toolsEnabled,
  onToolsChange,
  sendKey,
}: Props): React.ReactElement {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
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
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (sendKey === 'mod-enter') {
      if (!mod) return
    } else if (e.shiftKey || coarse) {
      return
    }
    e.preventDefault()
    if (!streaming && value.trim()) onSend()
  }

  return (
    <div className="composer border-t border-line bg-canvas px-3 pb-3 pt-2 sm:px-6 sm:pb-5">
      <div className="mx-auto max-w-3xl">
        <div
          className={`composer__box rounded-lg border bg-surface transition-colors ${
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

          <div className="composer__row flex items-start">
          <span className="composer__prompt" aria-hidden="true">&gt;</span>
          <textarea
            ref={ref}
            id="composer-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            placeholder={
              streaming
                ? '正在生成…'
                : editing
                  ? '改完直接发 —— 这一轮会被替换'
                  : coarse
                    ? '说点什么…'
                    : sendKey === 'mod-enter'
                    ? `说点什么…（${modKey}Enter 发送，Enter 换行）`
                    : '说点什么…（Enter 发送，Shift+Enter 换行）'
            }
            className="max-h-[220px] w-full resize-none bg-transparent px-3.5 py-3 text-[15px] leading-[1.7] text-ink outline-none placeholder:text-faint"
            aria-label="输入消息"
          />
          </div>

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-1">
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex max-w-[220px] items-center gap-1 rounded-xs border border-line bg-surface-2 py-0.5 pl-2 pr-1 text-[11px] text-muted"
                >
                  <span className="min-w-0 truncate">{a.name}</span>
                  <span className="shrink-0 text-faint">{formatSize(a.size)}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded-xs p-0.5 text-faint transition-colors hover:text-ink"
                    onClick={() => onRemoveAttachment(a.id)}
                    aria-label={`去掉 ${a.name}`}
                    title="去掉"
                  >
                    <X size={10} weight="bold" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="composer__bar flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  onFiles(e.target.files)
                  // 选完把 input 清空 —— 不然同一个文件再选一次就不触发 change 了
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => fileRef.current?.click()}
                aria-label="添加附件"
                title="添加附件（文本、PDF、Word、Excel、图片）"
              >
                <Paperclip size={15} weight="bold" />
              </button>

              <EffortPicker value={effort} onChange={onEffortChange} />

              <button
                type="button"
                className={`tag cursor-pointer normal-case ${
                  toolsEnabled ? 'text-ink-2' : 'text-faint'
                }`}
                onClick={() => onToolsChange(!toolsEnabled)}
                aria-pressed={toolsEnabled}
                title="工具：搜索网页、抓网页、读附件、认字"
              >
                <Wrench size={11} weight="bold" />
                工具 · {toolsEnabled ? '开' : '关'}
              </button>
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
        {/* 终端风格才显示：输入框下面那一行按键提示 */}
        <div className="composer__hint">
          {streaming ? (
            <span>
              <span className="term-ink">esc</span> 停止生成
            </span>
          ) : sendKey === 'mod-enter' ? (
            <span>
              <span className="term-ink">{modKey}⏎</span> 发送 · <span className="term-ink">⏎</span> 换行
            </span>
          ) : (
            <span>
              <span className="term-ink">⏎</span> 发送 · <span className="term-ink">⇧⏎</span> 换行
            </span>
          )}
          <span className="ml-auto">
            <span className="term-ink">/</span> 聚焦 · <span className="term-ink">{modKey}K</span> 搜索
          </span>
        </div>
      </div>
    </div>
  )
}
