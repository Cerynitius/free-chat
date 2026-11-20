import { useEffect, useState } from 'react'
import { LinkSimple } from '@phosphor-icons/react'
import { useApp } from '@/state/store'
import type { Conversation, FontSize } from '@/state/types'
import { applyTheme } from '@/lib/theme'
import { decodeConversation, hasSharedHash } from '@/lib/share'
import { Composer } from '@/ui/Composer'
import { EmptyState } from '@/ui/EmptyState'
import { ErrorBanner } from '@/ui/ErrorBanner'
import { MessageList } from '@/ui/MessageList'
import { SettingsPanel } from '@/ui/SettingsPanel'
import { Sidebar } from '@/ui/Sidebar'
import { Toast } from '@/ui/Toast'
import { TopBar } from '@/ui/TopBar'

/** 字号档位对应的根字号（px） */
const FONT_PX: Record<FontSize, number> = { sm: 14, md: 15, lg: 17 }

export function App(): React.ReactElement {
  const settings = useApp((s) => s.settings)
  const connection = useApp((s) => s.connection)
  const conversation = useApp((s) => s.conversations.find((c) => c.id === s.activeId))
  const streamingId = useApp((s) => s.streamingId)
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const settingsOpen = useApp((s) => s.settingsOpen)

  const updateSettings = useApp((s) => s.updateSettings)
  const sendMessage = useApp((s) => s.sendMessage)
  const stopGeneration = useApp((s) => s.stopGeneration)
  const importConversation = useApp((s) => s.importConversation)
  const newConversation = useApp((s) => s.newConversation)
  const testConnection = useApp((s) => s.testConnection)
  const setSidebarOpen = useApp((s) => s.setSidebarOpen)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const pushToast = useApp((s) => s.pushToast)

  const [input, setInput] = useState('')
  const [pendingShare, setPendingShare] = useState<Conversation | null>(null)

  const messages = conversation?.messages ?? []
  const px = FONT_PX[settings.fontSize]

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

  // 分享链接：读走就清 hash，不覆盖本地历史 —— 先问，确认了才存
  useEffect(() => {
    const readHash = (): void => {
      if (!hasSharedHash()) return
      const shared = decodeConversation<Conversation>(location.hash)
      history.replaceState(null, '', `${location.pathname}${location.search}`)
      if (!shared || !Array.isArray(shared.messages)) {
        pushToast({ text: '分享链接里的内容解析失败。', tone: 'error' })
        return
      }
      setPendingShare(shared)
    }

    readHash()
    // 把分享链接粘进一个已经打开的标签页不会触发重载，hash 变了但组件不重挂 ——
    // 所以还得单独听 hashchange。
    window.addEventListener('hashchange', readHash)
    return () => window.removeEventListener('hashchange', readHash)
  }, [pushToast])

  // 快捷键：Ctrl/Cmd+K 开设置，Ctrl/Cmd+N 开新对话
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        setSettingsOpen(true)
      } else if (key === 'n') {
        e.preventDefault()
        newConversation()
        setSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newConversation, setSettingsOpen, setSidebarOpen])

  const onSend = (): void => {
    const text = input
    if (!text.trim()) return
    void sendMessage(text)
    setInput('')
  }

  const onPick = (text: string): void => {
    void sendMessage(text)
  }

  const onKeepShared = (): void => {
    const shared = pendingShare
    setPendingShare(null)
    if (!shared) return
    // importConversation 自己会把新会话插到列表首位并把 activeId 指向它
    importConversation(shared)
  }

  const onDiscardShared = (): void => {
    setPendingShare(null)
  }

  const supportedEfforts = connection.models?.[0]?.supported_reasoning_efforts ?? []

  const composerHint =
    connection.status === 'error'
      ? '连不上服务 —— 点右上角的齿轮检查连接设置。'
      : connection.status === 'idle'
        ? '还没测过连接 —— 点右上角的齿轮可以先测一下。'
        : undefined

  return (
    <div
      className="flex h-full overflow-hidden"
      style={
        {
          fontSize: `${px}px`,
          // 正文（.prose-chat）读的是这个变量 —— 只改根字号的话消息正文不会跟着变
          '--text-body': `${px}px`,
        } as React.CSSProperties
      }
    >
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setSidebarOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />

        {connection.status === 'error' && (
          <div className="px-4 pt-3 sm:px-6">
            <div className="mx-auto max-w-3xl">
              <ErrorBanner
                message={connection.message ?? '连接失败'}
                onRetry={() => void testConnection()}
              />
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          {messages.length === 0 ? (
            <EmptyState onPick={onPick} />
          ) : (
            <MessageList conversation={conversation} />
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
          supportedEfforts={supportedEfforts}
          model={settings.model}
          hint={composerHint}
        />
      </main>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <Toast />

      {pendingShare && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[80] w-[min(360px,calc(100vw-2rem))]">
          <div className="panel pointer-events-auto p-3">
            <div className="flex items-start gap-2">
              <LinkSimple size={16} weight="bold" className="mt-0.5 shrink-0 text-blue-ink" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] leading-[1.5] text-ink">
                  这是分享出来的对话，要保存为新对话吗？
                </div>
                <div className="mt-1 text-[11px] leading-[1.5] text-muted">
                  不会动你本地的历史 —— 确认后另存为一条新会话。
                </div>
                <div className="mt-2.5 flex gap-2">
                  <button type="button" className="btn btn-primary" onClick={onKeepShared}>
                    保存为新对话
                  </button>
                  <button type="button" className="btn" onClick={onDiscardShared}>
                    丢弃
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}