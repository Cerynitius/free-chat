import { useMemo } from 'react'
import { Moon, Plus, Sun, Trash } from '@phosphor-icons/react'
import { useApp } from '@/state/store'
import { formatTime, groupOf, type DateGroup } from '@/lib/date'
import { resolveTheme } from '@/lib/theme'

interface Props {
  open: boolean
  onClose: () => void
}

/** 分组顺序固定 —— 不按字母排，读者习惯的是「最近的在最上面」 */
const GROUPS: DateGroup[] = ['今天', '昨天', '本周', '更早']

export function Sidebar({ open, onClose }: Props): React.ReactElement {
  const conversations = useApp((s) => s.conversations)
  const activeId = useApp((s) => s.activeId)
  const selectConversation = useApp((s) => s.selectConversation)
  const deleteConversation = useApp((s) => s.deleteConversation)
  const newConversation = useApp((s) => s.newConversation)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)

  // 列表按更新时间倒序；store 里是「新建在前」的插入序，不等于「最近在前」
  const grouped = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
    return GROUPS.map((name) => ({
      name,
      items: sorted.filter((c) => groupOf(c.updatedAt) === name),
    })).filter((g) => g.items.length > 0)
  }, [conversations])

  const onNew = (): void => {
    newConversation()
    onClose()
  }

  const onSelect = (id: string): void => {
    selectConversation(id)
    onClose()
  }

  const dark = resolveTheme(settings.theme) === 'dark'
  const toggleTheme = (): void => {
    updateSettings({ theme: dark ? 'light' : 'dark' })
  }

  return (
    <>
      {open && <div className="overlay lg:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-[55] flex w-[280px] shrink-0 flex-col',
          'border-r border-line bg-canvas',
          'transition-transform duration-200 ease-[var(--ease-out-expo)]',
          'lg:static lg:z-auto lg:w-[260px] lg:translate-x-0 lg:transition-none',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="border-b border-line px-3 py-3">
          <div className="mb-3 px-1 font-serif text-[15px] tracking-[-0.01em] text-ink">
            Hippocrene
          </div>
          <button type="button" className="btn btn-primary w-full" onClick={onNew}>
            <Plus size={15} weight="bold" />
            新对话
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="会话列表">

          {grouped.map((group) => (
            <div key={group.name} className="mb-4 last:mb-0">
              <div className="px-2 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-faint">
                {group.name}
              </div>

              {group.items.map((c) => (
                <div key={c.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className={[
                      'min-w-0 flex-1 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors',
                      c.id === activeId
                        ? 'bg-surface-2 text-ink'
                        : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                    ].join(' ')}
                  >
                    <span className="block truncate">{c.title || '未命名会话'}</span>
                  </button>

                  <span className="mr-0.5 shrink-0 font-mono text-[10px] text-faint">
                    {formatTime(c.updatedAt)}
                  </span>

                  <button
                    type="button"
                    className="btn btn-ghost btn-icon shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => deleteConversation(c.id)}
                    aria-label="删除会话"
                    title="删除会话"
                  >
                    <Trash size={14} weight="bold" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex items-center justify-end border-t border-line px-3 py-2">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={toggleTheme}
            aria-label={dark ? '切换到浅色主题' : '切换到深色主题'}
            title={dark ? '切换到浅色主题' : '切换到深色主题'}
          >
            {dark ? <Moon size={16} weight="bold" /> : <Sun size={16} weight="bold" />}
          </button>
        </div>
      </aside>
    </>
  )
}