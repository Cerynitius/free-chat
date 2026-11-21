import { useEffect, useRef, useState } from 'react'
import { Plus, SidebarSimple } from '@phosphor-icons/react'
import { useApp } from '@/state/store'
import { applyTheme } from '@/lib/theme'
import { addFile, removeAttachment, type Attachment } from '@/lib/attachments'
import { loadDraft, saveDraft } from '@/lib/storage'
import { Composer } from '@/ui/Composer'
import { SettingsDialog } from '@/ui/SettingsDialog'
import { useGlobalShortcuts } from '@/ui/shortcuts'
import { EmptyState, Starters } from '@/ui/EmptyState'
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
  const pushToast = useApp((s) => s.pushToast)
  const focusSearch = useApp((s) => s.focusSearch)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)

  const [input, setInput] = useState('')
  /** 正在改写的那条消息 —— 发出去会替换掉它后面的整轮对话 */
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null)
  /** 挂着的附件 —— 只在内存里，刷新就没了 */
  const [attachments, setAttachments] = useState<Attachment[]>([])

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

  // 字号挂在 <html> 上，CSS 按它缩放正文
  useEffect(() => {
    document.documentElement.dataset.fontSize = settings.fontSize
  }, [settings.fontSize])

  // 界面风格挂在 <html data-ui>：配色、字体、圆角全由 CSS 按它切换
  useEffect(() => {
    document.documentElement.dataset.ui = settings.uiStyle
  }, [settings.uiStyle])

  // 换了会话 ⇒ 改写模式作废；输入框换成那个会话没发出去的草稿
  const convId = conversation?.id
  useEffect(() => {
    setEditing(null)
    setInput(convId ? loadDraft(convId) : '')
  }, [convId])

  // 草稿：边打边存（攒 300 ms），刷新、切走再回来都还在。改写模式下打的字不算草稿
  const draftTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!convId || editing) return
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => saveDraft(convId, input), 300)
    return () => {
      if (draftTimer.current !== null) window.clearTimeout(draftTimer.current)
    }
  }, [convId, input, editing])

  useGlobalShortcuts({
    search: focusSearch,
    newChat: () => onNewChat(),
    settings: () => setSettingsOpen(true),
    toggleSidebar: () => setSidebarCollapsed(!useApp.getState().sidebarCollapsed),
    focusComposer: () => document.getElementById('composer-input')?.focus(),
    stop: () => {
      if (!useApp.getState().streamingId) return false
      stopGeneration()
      return true
    },
  })

  const onSend = (): void => {
    const text = input
    if (!text.trim()) return
    // 改写发出去之后，输入框回到这段会话原来的草稿；正常发送则草稿就是刚发的这句，清掉
    if (editing) setInput(convId ? loadDraft(convId) : '')
    else {
      setInput('')
      if (convId) saveDraft(convId, '')
    }
    // 附件名跟着消息走 —— 模型得知道有哪些文件可读
    const names = attachments.map((a) => a.name)
    if (editing) {
      const id = editing.id
      setEditing(null)
      // 改写：这一轮之后的东西全作废，重新问一遍
      void editMessage(id, text, names)
    } else {
      void sendMessage(text, names)
    }
  }

  const onEdit = (m: Message): void => {
    setEditing({ id: m.id, content: m.content })
    setInput(m.content)
  }

  const onCancelEdit = (): void => {
    setEditing(null)
    setInput(convId ? loadDraft(convId) : '')
  }

  const onNewChat = (): void => {
    newConversation()
    setEditing(null)
  }

  /**
   * 加附件。
   *
   * 文本类当场读出内容（不离开本机），二进制类只把字节留在手上 ——
   * 等工具真的要用的时候才发给文档服务。
   */
  const onFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return
    const added: Attachment[] = []
    for (const file of Array.from(files)) {
      try {
        added.push(await addFile(file))
      } catch (err) {
        pushToast({
          text: err instanceof Error ? err.message : `${file.name} 读不了`,
          tone: 'warn',
        })
      }
    }
    if (added.length) setAttachments((prev) => [...prev, ...added])
  }

  const onRemoveAttachment = (id: string): void => {
    removeAttachment(id)
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className={`app-main flex min-w-0 flex-1 flex-col${messages.length === 0 ? ' is-empty' : ''}`}>
        {/*
          顶栏：
            手机 —— 只有一个抽屉按钮（侧边栏是抽屉）
            桌面 —— 侧边栏收起按钮 + 新对话（侧边栏收起来时也得有地方开新会话）
        */}
        <div className="topbar flex h-11 shrink-0 items-center gap-1 px-2 sm:px-3">
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
            className="btn btn-ghost btn-icon"
            onClick={onNewChat}
            aria-label="新对话"
            title="新对话"
          >
            <Plus size={17} weight="bold" />
          </button>

          {/* 终端风格才显示：像终端窗口的标题栏 */}
          <div className="topbar__title min-w-0 flex-1 truncate">
            <span className="topbar__prefix">free-chat <span className="term-dim">—</span> </span>
            {conversation?.title || '新会话'}
          </div>
        </div>

        <div className="chat-body flex min-h-0 flex-1 flex-col">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            <MessageList conversation={conversation} onEdit={onEdit} />
          )}
        </div>

        <Composer
          value={input}
          starters={
            messages.length === 0 && settings.uiStyle !== 'terminal' ? (
              <Starters
                onPick={(t) => {
                  setInput(t)
                  requestAnimationFrame(() => {
                    const el = document.getElementById('composer-input') as HTMLTextAreaElement | null
                    el?.focus()
                    el?.setSelectionRange(t.length, t.length)
                  })
                }}
              />
            ) : null
          }
          onChange={setInput}
          onSend={onSend}
          onStop={stopGeneration}
          streaming={streamingId !== null}
          effort={settings.effort}
          onEffortChange={(v) => updateSettings({ effort: v })}
          editing={editing !== null}
          onCancelEdit={onCancelEdit}
          attachments={attachments}
          onFiles={(files) => void onFiles(files)}
          onRemoveAttachment={onRemoveAttachment}
          toolsEnabled={settings.tools}
          onToolsChange={(v) => updateSettings({ tools: v })}
          sendKey={settings.sendKey}
        />
      </main>

      <SettingsDialog />
      <Toast />
    </div>
  )
}
