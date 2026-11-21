import { useMemo, useRef, useState } from 'react'
import { DotsThree, Moon, Plus, PushPin, Sun } from '@phosphor-icons/react'
import { useApp } from '@/state/store'
import { formatTime, groupOf, type DateGroup } from '@/lib/date'
import { resolveTheme } from '@/lib/theme'
import { MAX_TITLE_LEN } from '@/lib/title'
import { ContextMenu, type MenuItem } from './ContextMenu'

interface Props {
  open: boolean
  onClose: () => void
}

/** 分组顺序固定 —— 不按字母排，读者习惯的是「最近的在最上面」 */
const GROUPS: DateGroup[] = ['今天', '昨天', '本周', '更早']

interface MenuState {
  x: number
  y: number
  id: string
}

export function Sidebar({ open, onClose }: Props): React.ReactElement {
  const conversations = useApp((s) => s.conversations)
  const activeId = useApp((s) => s.activeId)
  const collapsed = useApp((s) => s.sidebarCollapsed)
  const selectConversation = useApp((s) => s.selectConversation)
  const deleteConversation = useApp((s) => s.deleteConversation)
  const renameConversation = useApp((s) => s.renameConversation)
  const togglePin = useApp((s) => s.togglePin)
  const newConversation = useApp((s) => s.newConversation)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)

  /** 正在改名的会话 —— 名字就地编辑，不弹窗 */
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const renameRef = useRef<HTMLInputElement | null>(null)

  // 列表按更新时间倒序；store 里是「新建在前」的插入序，不等于「最近在前」
  const { pinned, groups } = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
    // 空会话（没消息、没名字、没置顶）不进列表 ——
    // 新开的对话不该在列表里白占一行（它就是背后的欢迎界面）
    const visible = sorted.filter((c) => c.messages.length > 0 || c.title || c.pinned)
    return {
      // 置顶的单独一组 —— 不跟着日期跑
      pinned: visible.filter((c) => c.pinned),
      groups: GROUPS.map((name) => ({
        name,
        items: visible.filter((c) => !c.pinned && groupOf(c.updatedAt) === name),
      })).filter((g) => g.items.length > 0),
    }
  }, [conversations])

  const onNew = (): void => {
    newConversation()
    onClose()
  }

  const onSelect = (id: string): void => {
    selectConversation(id)
    onClose()
  }

  const startRename = (id: string, current: string): void => {
    setRenamingId(id)
    setDraft(current)
    // 等 input 挂上来再全选
    requestAnimationFrame(() => {
      renameRef.current?.focus()
      renameRef.current?.select()
    })
  }

  const commitRename = (): void => {
    if (renamingId) renameConversation(renamingId, draft)
    setRenamingId(null)
  }

  const menuItems = (id: string): MenuItem[] => {
    const conv = conversations.find((c) => c.id === id)
    if (!conv) return []
    return [
      { label: '重命名', onSelect: () => startRename(id, conv.title) },
      { label: conv.pinned ? '取消置顶' : '置顶', onSelect: () => togglePin(id) },
      { label: '删除', onSelect: () => deleteConversation(id), danger: true },
    ]
  }

  const dark = resolveTheme(settings.theme) === 'dark'
  const toggleTheme = (): void => {
    updateSettings({ theme: dark ? 'light' : 'dark' })
  }

  const renderRow = (c: (typeof conversations)[number]): React.ReactElement => {
    const renaming = renamingId === c.id
    return (
      <div
        key={c.id}
        className="group flex items-center"
        onContextMenu={(e) => {
          // 右键呼出菜单 —— 重命名 / 置顶 / 删除都在里面
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, id: c.id })
        }}
      >
        {renaming ? (
          <input
            ref={renameRef}
            value={draft}
            maxLength={MAX_TITLE_LEN}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setRenamingId(null)
            }}
            className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1.5 text-[13px] text-ink outline-none"
            aria-label="会话名称"
            placeholder="给这段会话起个名字"
          />
        ) : (
          <button
            type="button"
            onClick={() => onSelect(c.id)}
            className={[
              'flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors',
              c.id === activeId
                ? 'bg-surface-2 text-ink'
                : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            ].join(' ')}
          >
            {c.pinned && (
              <PushPin size={11} weight="fill" className="shrink-0 text-muted" aria-label="已置顶" />
            )}
            {/* 名字太长就在这儿收成「…」—— 完整名字挂在 title 上 */}
            <span className="min-w-0 flex-1 truncate" title={c.title || '未命名会话'}>
              {c.title || '未命名会话'}
            </span>
          </button>
        )}

        <span className="mr-0.5 shrink-0 font-mono text-[10px] text-faint">
          {formatTime(c.updatedAt)}
        </span>

        {!renaming && (
          <button
            type="button"
            className="btn btn-ghost btn-icon shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            onClick={(e) => {
              // 菜单从这个按钮底下弹出来
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({ x: r.right - 160, y: r.bottom + 4, id: c.id })
            }}
            aria-label="更多操作"
            title="更多操作"
          >
            <DotsThree size={14} weight="bold" />
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      {open && <div className="overlay lg:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-[55] flex w-[280px] shrink-0 flex-col overflow-hidden',
          'border-r border-line bg-canvas',
          'transition-transform duration-200 ease-[var(--ease-out-expo)]',
          'lg:static lg:z-auto lg:translate-x-0 lg:transition-[width,transform] lg:duration-200',
          collapsed ? 'lg:w-0 lg:border-r-0' : 'lg:w-[260px]',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        aria-hidden={collapsed ? true : undefined}
      >
        {/* 里面的内容宽度锁死 —— 侧边栏收起时是「宽度归零」，不是「内容挤扁」 */}
        <div className="flex h-full w-[280px] shrink-0 flex-col lg:w-[260px]">
          <div className="border-b border-line px-3 py-3">
            <div className="mb-3 px-1 font-serif text-[15px] tracking-[-0.01em] text-ink">
              Hippocrene
            </div>
            <button type="button" className="btn btn-primary w-full" onClick={onNew}>
              <Plus size={15} weight="bold" />
              新对话
            </button>
          </div>

          <nav
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-3"
            aria-label="会话列表"
          >
            {pinned.length > 0 && (
              <div className="mb-4 last:mb-0">
                <div className="px-2 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-faint">
                  已置顶
                </div>
                {pinned.map(renderRow)}
              </div>
            )}

            {groups.map((group) => (
              <div key={group.name} className="mb-4 last:mb-0">
                <div className="px-2 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-faint">
                  {group.name}
                </div>

                {group.items.map(renderRow)}
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
        </div>
      </aside>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.id)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}
