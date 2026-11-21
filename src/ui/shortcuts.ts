import { useEffect, useRef } from 'react'

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** 界面上显示的修饰键 */
export const modKey = isMac ? '⌘' : 'Ctrl+'

export interface ShortcutHandlers {
  search: () => void
  newChat: () => void
  settings: () => void
  toggleSidebar: () => void
  focusComposer: () => void
  stop: () => boolean
}

/** 设置面板里列出来的快捷键 —— 和下面的实现放在一处，改一个不会忘了另一个 */
export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: `${modKey}K`, what: '搜索会话' },
  { keys: `${modKey}${isMac ? '⇧' : 'Shift+'}O`, what: '新对话' },
  { keys: `${modKey}${isMac ? '⇧' : 'Shift+'}S`, what: '收起 / 展开侧边栏' },
  { keys: `${modKey},`, what: '设置与数据' },
  { keys: '/', what: '跳到输入框' },
  { keys: 'Esc', what: '停止生成' },
]

export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  // 处理函数每次渲染都是新的 —— 放进 ref，监听只挂一次
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const h = ref.current
      if (e.isComposing) return
      const mod = isMac ? e.metaKey : e.ctrlKey
      const key = e.key.toLowerCase()
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (mod && !e.shiftKey && !e.altKey && key === 'k') {
        e.preventDefault()
        h.search()
      } else if (mod && e.shiftKey && key === 'o') {
        e.preventDefault()
        h.newChat()
      } else if (mod && e.shiftKey && key === 's') {
        e.preventDefault()
        h.toggleSidebar()
      } else if (mod && !e.shiftKey && key === ',') {
        e.preventDefault()
        h.settings()
      } else if (!mod && !e.altKey && e.key === '/' && !typing) {
        e.preventDefault()
        h.focusComposer()
      } else if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) {
        // 弹窗开着时 Esc 归弹窗（关掉它），不去停生成
        if (h.stop()) e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
