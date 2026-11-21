import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  onSelect: () => void
  /** 危险操作（比如删除）—— 染红 */
  danger?: boolean
}

interface Props {
  /** 出现的位置（视口坐标） */
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** 菜单离边缘至少留这么多 —— 贴着屏幕边弹出来会被切掉一半 */
const MARGIN = 8
const ITEM_H = 30

/**
 * 右键菜单。
 *
 * 规则跟系统菜单一致：
 *   · 位置贴着光标，但不许越过屏幕边缘
 *   · 点外面 / 按 Esc / 滚页面 ⇒ 关掉
 *   · 上下键能挪，Enter 能选
 */
export function ContextMenu({ x, y, items, onClose }: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [active, setActive] = useState(0)

  // 先量再摆 —— 不量就不知道会不会顶出屏幕
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    setPos({
      left: Math.min(x, vw - width - MARGIN),
      top: Math.min(y, vh - height - MARGIN),
    })
  }, [x, y, items.length])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + items.length) % items.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        items[active]?.onSelect()
        onClose()
      }
    }
    const onScroll = (): void => onClose()

    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onScroll)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [items, active, onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="context-menu"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={[
            'context-menu__item',
            item.danger ? 'context-menu__item--danger' : '',
            i === active ? 'context-menu__item--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ minHeight: ITEM_H }}
          onMouseEnter={() => setActive(i)}
          onClick={() => {
            item.onSelect()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    // ★ 挂到 body 上：菜单常常是从一个 opacity-0 / overflow-hidden 的容器里
    //   弹出来的 —— 不脱离那个容器，它会被一起裁掉（或者一直透明）。
    document.body,
  )
}
