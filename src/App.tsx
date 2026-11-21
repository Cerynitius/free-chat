import { useEffect, useState } from 'react'
import { Plus, SidebarSimple } from '@phosphor-icons/react'
import { useApp } from '@/state/store'
import { applyTheme } from '@/lib/theme'
import { Composer } from '@/ui/Composer'
import { EmptyState } from '@/ui/EmptyState'
import { MessageList } from '@/ui/MessageList'
import { Sidebar } from '@/ui/Sidebar'
import { Toast } from '@/ui/Toast'
import type { Message } from '@/state/types'

export function App(): React.ReactElement {
  const settings = useApp((s) => s.settings)
  const conversation = useApp((s) => s.conversations.find((c) => c.id === s.activeId))
  const streamingId = useApp((s) => s.streamingId)
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const sidebarCollapsed = useApp((s) => s.sidebarCollapsed)

  const updateSettings = useApp((s) => s.updateSettings)
  const sendMessage = useApp((s) => s.sendMessage)
  const stopGeneration = useApp((s) => s.stopGeneration)
  const setSidebarOpen = useApp((s) => s.setSidebarOpen)
  const setSidebarCollapsed = useApp((s) => s.setSidebarCollapsed)
  const newConversation = useApp((s) => s.newConversation)
  const editMessage = useApp((s) => s.editMessage)

  const [input, setInput] = useState('')
  /** 正在改写的那条消息 —— 发出去会替换掉它后面的整轮对话 */
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null)

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

  // 换了会话 ⇒ 手上改到一半的东西作废
  useEffect(() => {
    setEditing(null)
    setInput('')
  }, [conversation?.id])

  const onSend = (): void => {
    const text = input
    if (!text.trim()) return
    setInput('')
    if (editing) {
      const id = editing.id
      setEditing(null)
      // 改写：这一轮之后的东西全作废，重新问一遍
      void editMessage(id, text)
    } else {
      void sendMessage(text)
    }
  }

  const onEdit = (m: Message): void => {
    setEditing({ id: m.id, content: m.content })
    setInput(m.content)
  }

  const onCancelEdit = (): void => {
    setEditing(null)
    setInput('')
  }

  const onNewChat = (): void => {
    newConversation()
    setEditing(null)
    setInput('')
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex min-w-0 flex-1 flex-col">
        {/*
          顶栏：
            手机 —— 只有一个抽屉按钮（侧边栏是抽屉）
            桌面 —— 侧边栏收起按钮 + 新对话（侧边栏收起来时也得有地方开新会话）
        */}
        <div className="flex h-11 shrink-0 items-center gap-1 px-2 sm:px-3">
          <button
            type="button"
            className="btn btn-ghost btn-icon lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="会话列表"
            title="会话列表"
          >
            <SidebarSimple size={17} weight="bold" />
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-icon hidden lg:inline-flex"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            <SidebarSimple size={17} weight="bold" />
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-icon hidden lg:inline-flex"
            onClick={onNewChat}
            aria-label="新对话"
            title="新对话"
          >
            <Plus size={17} weight="bold" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            <MessageList conversation={conversation} onEdit={onEdit} />
          )}
        </div>

        <Composer
          value={input}
          onChange={setInput}
          onSend={onSend}
          onStop={stopGeneration}
          streaming={streamingId !== null}
          effort={settings.effort}
          onEffortChange={(v) => updateSettings({ effort: v })}
          editing={editing !== null}
          onCancelEdit={onCancelEdit}
        />
      </main>

      <Toast />
    </div>
  )
}
