import { useEffect, useMemo, useRef, useState } from 'react'
import { ChatCircleText, DotsThree, GearSix, MagnifyingGlass, Moon, Plus, PushPin, Sun, TerminalWindow, X } from '@phosphor-icons/react'
import { useApp } from '@/state/store'
import { formatTime, groupOf, type DateGroup } from '@/lib/date'
import { conversationToMarkdown, download, safeFileName } from '@/lib/export'
import { searchConversations, splitMarks } from '@/lib/search'
import { resolveTheme } from '@/lib/theme'
import { MAX_TITLE_LEN } from '@/lib/title'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { modKey } from './shortcuts'

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
  const historyLoaded = useApp((s) => s.historyLoaded)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const searchFocusTick = useApp((s) => s.searchFocusTick)
  const pushToast = useApp((s) => s.pushToast)

  /** 搜索词 —— 有词的时候列表换成搜索结果 */
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Ctrl+K：把焦点交给搜索框（侧边栏收着的话 store 那边已经把它展开了）
  useEffect(() => {
    if (!searchFocusTick) return
    requestAnimationFrame(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    })
  }, [searchFocusTick])

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

  const hits = useMemo(
    () => (query.trim() ? searchConversations(conversations.filter((c) => c.messages.length > 0), query) : null),
    [conversations, query],
  )

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
      {
        label: '导出为 Markdown',
        onSelect: () => {
          download(
            `${safeFileName(conv.title)}.md`,
            conversationToMarkdown(conv, settings.exportReasoning),
            'text/markdown',
          )
          pushToast({ text: '已导出这段会话', tone: 'ok' })
        },
      },
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
        className="sidebar__item group flex items-center"
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
              'sidebar__row flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors',
              c.id === activeId ? 'is-active' : '',
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

        <span className="sidebar__time mr-0.5 shrink-0 font-mono text-[10px] text-faint">
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
          'sidebar fixed inset-y-0 left-0 z-[55] flex w-[280px] shrink-0 flex-col overflow-hidden',
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
          <div className="sidebar__head border-b border-line px-3 py-3">
            <div className="sidebar__brand mb-3 px-1 font-serif text-[15px] tracking-[-0.01em] text-ink">Free Chat</div>
            <button type="button" className="sidebar__new btn btn-primary w-full" onClick={onNew}>
              <span className="sidebar__new-icon">
                <Plus size={15} weight="bold" />
              </span>
              新对话
            </button>
            <label className="sidebar-search mt-2">
              <MagnifyingGlass size={13} weight="bold" className="shrink-0 text-faint" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQuery('')
                    e.currentTarget.blur()
                  }
                  if (e.key === 'Enter' && hits && hits.length) {
                    onSelect(hits[0].conv.id)
                  }
                }}
                placeholder="搜索会话"
                aria-label="搜索会话"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
              />
              {query ? (
                <button
                  type="button"
                  className="shrink-0 rounded-xs p-0.5 text-faint hover:text-ink"
                  onClick={() => setQuery('')}
                  aria-label="清空搜索"
                >
                  <X size={11} weight="bold" />
                </button>
              ) : (
                <kbd className="kbd kbd-hint shrink-0">{modKey}K</kbd>
              )}
            </label>
          </div>

          <nav
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-3"
            aria-label="会话列表"
          >
            {hits && (
              <div>
                <div className="sidebar__group-label px-2 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-faint">
                  {hits.length ? `找到 ${hits.length} 段会话` : '没有找到'}
                </div>
                {hits.map((h) => (
                  <button
                    key={h.conv.id}
                    type="button"
                    onClick={() => onSelect(h.conv.id)}
                    className={[
                      'mb-0.5 block w-full rounded-sm px-2 py-1.5 text-left transition-colors',
                      h.conv.id === activeId ? 'bg-surface-2' : 'hover:bg-surface-2',
                    ].join(' ')}
                  >
                    <span className="block truncate text-[13px] text-ink">{h.conv.title || '未命名会话'}</span>
                    {h.snippet && (
                      <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-[1.5] text-muted">
                        {splitMarks(h.snippet, h.marks).map((p, i) =>
                          p.hit ? (
                            <mark key={i} className="search-mark">
                              {p.text}
                            </mark>
                          ) : (
                            <span key={i}>{p.text}</span>
                          ),
                        )}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {!hits && !historyLoaded && (
              <div className="px-2 py-1 text-[12px] text-faint">正在读取本地历史…</div>
            )}

            {!hits && historyLoaded && pinned.length === 0 && groups.length === 0 && (
              <div className="px-2 py-1 text-[12px] leading-[1.6] text-faint">
                还没有会话。聊过的内容只保存在这个浏览器里。
              </div>
            )}

            {!hits && pinned.length > 0 && (
              <div className="mb-4 last:mb-0">
                <div className="sidebar__group-label px-2 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-faint">
                  已置顶
                </div>
                {pinned.map(renderRow)}
              </div>
            )}

            {!hits && groups.map((group) => (
              <div key={group.name} className="mb-4 last:mb-0">
                <div className="sidebar__group-label px-2 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-faint">
                  {group.name}
                </div>

                {group.items.map(renderRow)}
              </div>
            ))}
          </nav>

          <div className="sidebar__foot flex items-center gap-1 border-t border-line px-3 py-2">
            <button
              type="button"
              className="btn btn-ghost h-8 gap-1.5 px-2 text-[12.5px] text-muted hover:text-ink"
              onClick={() => {
                setSettingsOpen(true)
                onClose()
              }}
              title={`设置（${modKey},）`}
            >
              <GearSix size={15} weight="bold" />
              设置与数据
            </button>
            <span className="ml-auto" />
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={() => updateSettings({ uiStyle: settings.uiStyle === 'web' ? 'terminal' : 'web' })}
              aria-label={settings.uiStyle === 'web' ? '切换到终端风格' : '切换到网页对话风格'}
              title={settings.uiStyle === 'web' ? '切换到终端风格' : '切换到网页对话风格'}
            >
              {settings.uiStyle === 'web' ? <TerminalWindow size={16} weight="bold" /> : <ChatCircleText size={16} weight="bold" />}
            </button>
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
