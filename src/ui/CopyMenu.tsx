import { useState } from 'react'
import { CaretDown, Check, Copy } from '@phosphor-icons/react'
import { copyText } from '@/lib/clipboard'
import { ContextMenu, type MenuItem } from './ContextMenu'

interface Props {
  /** 纯文本 —— 直接复制的那一份 */
  text: string
  /** Markdown 原文 —— 「复制为 Markdown」的那一份 */
  markdown?: string
  /** 无障碍标签 */
  label?: string
}

/**
 * 复制按钮组。
 *
 * 图标本身是「直接复制」（纯文本，一粘就能用），
 * 旁边的小箭头才是那份 Markdown 原文 —— 两份内容长得不一样，用途也不一样。
 */
export function CopyMenu({ text, markdown, label = '复制' }: Props): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const flash = (): void => {
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const doCopy = async (s: string): Promise<void> => {
    const ok = await copyText(s)
    if (!ok) return
    flash()
  }

  const items: MenuItem[] = [{ label: '复制', onSelect: () => void doCopy(text) }]
  if (markdown !== undefined) {
    items.push({ label: '复制为 Markdown', onSelect: () => void doCopy(markdown) })
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={() => void doCopy(text)}
        aria-label={copied ? '已复制' : label}
        title={copied ? '已复制' : label}
      >
        {copied ? <Check size={15} weight="bold" /> : <Copy size={15} weight="bold" />}
      </button>

      <button
        type="button"
        className="btn btn-ghost btn-icon -ml-1.5"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.right - 150, y: r.bottom + 4 })
        }}
        aria-label="复制选项"
        title="复制选项"
      >
        <CaretDown size={12} weight="bold" />
      </button>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  )
}
