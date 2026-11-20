import { GearSix, Moon, SidebarSimple, Sun } from '@phosphor-icons/react'
import { useApp } from '@/state/store'
import { estimateMessageTokens } from '@/lib/tokens'
import { resolveTheme } from '@/lib/theme'
import { ConnectionBadge } from './ConnectionBadge'
import { TokenMeter } from './TokenMeter'

interface Props {
  onMenu: () => void
  onOpenSettings: () => void
}

/** 拿不到 context_length 时的兜底 —— 1M token 是个合理的大数 */
const FALLBACK_CONTEXT = 1048576

export function TopBar({ onMenu, onOpenSettings }: Props): React.ReactElement {
  const settings = useApp((s) => s.settings)
  const connection = useApp((s) => s.connection)
  const conversation = useApp((s) => s.conversations.find((c) => c.id === s.activeId))
  const updateSettings = useApp((s) => s.updateSettings)

  // 服务端不返 usage，只能自己估；估算逻辑放在 lib/tokens 里，别在 UI 里重写一遍
  const used = (conversation?.messages ?? []).reduce(
    (sum, m) => sum + estimateMessageTokens(m.content, m.reasoning),
    0,
  )
  const limit = connection.models?.[0]?.context_length ?? FALLBACK_CONTEXT

  const dark = resolveTheme(settings.theme) === 'dark'

  const toggleTheme = (): void => {
    updateSettings({ theme: dark ? 'light' : 'dark' })
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-canvas px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-icon lg:hidden"
          onClick={onMenu}
          aria-label="打开会话列表"
          title="会话列表"
        >
          <SidebarSimple size={17} weight="bold" />
        </button>
        <span className="truncate font-serif text-[15px] tracking-[-0.01em] text-ink sm:text-[17px]">
          <span className="hidden sm:inline">Hippocrene&apos;s Model Chat</span>
          <span className="sm:hidden">Hippocrene</span>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <ConnectionBadge onClick={onOpenSettings} />

        <div className="hidden sm:block">
          <TokenMeter used={used} limit={limit} />
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={toggleTheme}
          aria-label={dark ? '切换到浅色主题' : '切换到深色主题'}
          title={dark ? '切换到浅色主题' : '切换到深色主题'}
        >
          {dark ? <Moon size={16} weight="bold" /> : <Sun size={16} weight="bold" />}
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onOpenSettings}
          aria-label="打开设置"
          title="设置"
        >
          <GearSix size={16} weight="bold" />
        </button>
      </div>
    </header>
  )
}