import { useEffect, useState } from 'react'
import { SidebarSimple } from '@phosphor-icons/react'
import { useApp } from '@/state/store'
import { applyTheme } from '@/lib/theme'
import { Composer } from '@/ui/Composer'
import { EmptyState } from '@/ui/EmptyState'
import { MessageList } from '@/ui/MessageList'
import { Sidebar } from '@/ui/Sidebar'
import { Toast } from '@/ui/Toast'

export function App(): React.ReactElement {
  const settings = useApp((s) => s.settings)
  const conversation = useApp((s) => s.conversations.find((c) => c.id === s.activeId))
  const streamingId = useApp((s) => s.streamingId)
  const sidebarOpen = useApp((s) => s.sidebarOpen)

  const updateSettings = useApp((s) => s.updateSettings)
  const sendMessage = useApp((s) => s.sendMessage)
  const stopGeneration = useApp((s) => s.stopGeneration)
  const setSidebarOpen = useApp((s) => s.setSidebarOpen)

  const [input, setInput] = useState('')

  const messages = conversation?.messages ?? []

  // 主题：class 策略挂在 <html> 上，system 还要盯着系统偏好变化
  useEffect(() => {
    applyTheme(settings.theme)
    if (settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [settings.theme])

  /**
   * 移动端软键盘：软键盘弹起时 visualViewport 会变矮，
   * 把这个高度写进 --app-h，#root 就会跟着缩，输入框不会被键盘顶飞。
   */
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = (): void => {
      document.documentElement.style.setProperty('--app-h', `${Math.round(vv.height)}px`)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  const onSend = (): void => {
    const text = input
    if (!text.trim()) return
    void sendMessage(text)
    setInput('')
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* 移动端才有一条窄顶栏：只有一个抽屉按钮，桌面端主区不留任何 chrome */}
        <div className="flex h-11 shrink-0 items-center px-2 lg:hidden">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="会话列表"
            title="会话列表"
          >
            <SidebarSimple size={17} weight="bold" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {messages.length === 0 ? <EmptyState /> : <MessageList conversation={conversation} />}
        </div>

        <Composer
          value={input}
          onChange={setInput}
          onSend={onSend}
          onStop={stopGeneration}
          streaming={streamingId !== null}
          effort={settings.effort}
          onEffortChange={(v) => updateSettings({ effort: v })}
        />
      </main>

      <Toast />
    </div>
  )
}