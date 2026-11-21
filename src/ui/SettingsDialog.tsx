import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DownloadSimple, HardDrives, Trash, UploadSimple, X } from '@phosphor-icons/react'
import { useApp } from '@/state/store'
import { flushPending } from '@/state/persist'
import { requestPersist, storageInfo, type StorageInfo } from '@/lib/db'
import { backupFileName, download, formatBytes, makeBackup, parseBackup } from '@/lib/export'
import { clearDrafts } from '@/lib/storage'
import type { FontSize, SendKey, ThemeMode, UiStyle } from '@/state/types'
import { SHORTCUTS, modKey } from './shortcuts'

/** 自定义指令的长度上限 —— 它每一轮都会发给模型，太长就是在烧上下文 */
const MAX_INSTRUCTIONS = 2000

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}): React.ReactElement {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'segmented__item is-on' : 'segmented__item'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Row({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="settings-row">
      <div className="min-w-0">
        <div className="text-[13.5px] text-ink">{title}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-[1.55] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SettingsDialog(): React.ReactElement | null {
  const open = useApp((s) => s.settingsOpen)
  const setOpen = useApp((s) => s.setSettingsOpen)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const conversations = useApp((s) => s.conversations)
  const importConversations = useApp((s) => s.importConversations)
  const clearConversations = useApp((s) => s.clearConversations)
  const pushToast = useApp((s) => s.pushToast)

  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [instructions, setInstructions] = useState(settings.instructions)
  const [confirmClear, setConfirmClear] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const saved = conversations.filter((c) => c.messages.length > 0 || c.pinned)

  const refreshInfo = (): void => {
    void storageInfo().then(setInfo)
  }

  useEffect(() => {
    if (!open) return
    setInstructions(useApp.getState().settings.instructions)
    setConfirmClear(false)
    refreshInfo()
    requestAnimationFrame(() => panelRef.current?.focus())
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // 「再点一次确认」过几秒自己复原 —— 别让一个误触的按钮一直待命
  useEffect(() => {
    if (!confirmClear) return
    const t = window.setTimeout(() => setConfirmClear(false), 4000)
    return () => window.clearTimeout(t)
  }, [confirmClear])

  if (!open) return null

  const commitInstructions = (): void => {
    const v = instructions.slice(0, MAX_INSTRUCTIONS)
    if (v !== settings.instructions) {
      updateSettings({ instructions: v })
      pushToast({ text: v.trim() ? '自定义指令已保存，下一条消息起生效' : '自定义指令已清空', tone: 'ok' })
    }
  }

  const onExport = async (): Promise<void> => {
    await flushPending()
    const s = useApp.getState()
    const backup = makeBackup(s.conversations, s.settings)
    download(backupFileName(), JSON.stringify(backup, null, 1), 'application/json')
    pushToast({ text: `已导出 ${backup.conversations.length} 段会话`, tone: 'ok' })
  }

  const onImport = async (files: FileList | null): Promise<void> => {
    const file = files?.[0]
    if (!file) return
    try {
      const { conversations: list, skipped } = parseBackup(await file.text())
      await flushPending()
      const { added, updated } = importConversations(list)
      const parts = [`新增 ${added} 段`, `更新 ${updated} 段`]
      const same = list.length - added - updated
      if (same > 0) parts.push(`${same} 段已是最新`)
      if (skipped) parts.push(`${skipped} 条格式不对跳过了`)
      pushToast({ text: `导入完成：${parts.join('，')}`, tone: 'ok' })
      refreshInfo()
    } catch (err) {
      pushToast({ text: `导入失败：${err instanceof Error ? err.message : String(err)}`, tone: 'error' })
    }
  }

  const onClear = async (): Promise<void> => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    await flushPending()
    clearConversations()
    clearDrafts()
    setConfirmClear(false)
    pushToast({ text: '本地会话已全部清空', tone: 'ok' })
    window.setTimeout(refreshInfo, 800)
  }

  const onPersist = async (): Promise<void> => {
    const ok = await requestPersist()
    pushToast({
      text: ok ? '已开启持久存储：浏览器清理空间时不会动这里的会话' : '浏览器没有批准（常用一段时间、或把站点加入书签 / 安装为应用后再试）',
      tone: ok ? 'ok' : 'warn',
    })
    refreshInfo()
  }

  return createPortal(
    <div className="dialog-layer" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div
        ref={panelRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="设置与数据"
        tabIndex={-1}
      >
        <div className="dialog__head">
          <h2 className="font-serif text-[18px] tracking-[-0.01em] text-ink">设置与数据</h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setOpen(false)}
            aria-label="关闭"
            title="关闭（Esc）"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="dialog__body">
          <section>
            <h3 className="settings-h">外观</h3>
            <Row title="界面风格" hint={settings.uiStyle === 'web' ? '暖色纸面，衬线正文' : '等宽字体，命令行式排版'}>
              <Segmented<UiStyle>
                label="界面风格"
                value={settings.uiStyle}
                onChange={(uiStyle) => updateSettings({ uiStyle })}
                options={[
                  { value: 'web', label: '网页对话' },
                  { value: 'terminal', label: '终端' },
                ]}
              />
            </Row>
            <Row title="主题">
              <Segmented<ThemeMode>
                label="主题"
                value={settings.theme}
                onChange={(theme) => updateSettings({ theme })}
                options={[
                  { value: 'light', label: '浅色' },
                  { value: 'dark', label: '深色' },
                  { value: 'system', label: '跟随系统' },
                ]}
              />
            </Row>
            <Row title="字号" hint="对话正文的大小">
              <Segmented<FontSize>
                label="字号"
                value={settings.fontSize}
                onChange={(fontSize) => updateSettings({ fontSize })}
                options={[
                  { value: 'sm', label: '小' },
                  { value: 'md', label: '中' },
                  { value: 'lg', label: '大' },
                ]}
              />
            </Row>
            <Row
              title="发送方式"
              hint={settings.sendKey === 'enter' ? 'Shift+Enter 换行' : 'Enter 换行'}
            >
              <Segmented<SendKey>
                label="发送方式"
                value={settings.sendKey}
                onChange={(sendKey) => updateSettings({ sendKey })}
                options={[
                  { value: 'enter', label: 'Enter' },
                  { value: 'mod-enter', label: `${modKey}Enter` },
                ]}
              />
            </Row>
          </section>

          <section>
            <h3 className="settings-h">自定义指令</h3>
            <p className="mb-2 text-[12px] leading-[1.6] text-muted">
              每一轮对话都会带上这段话，比如「回答用简体中文，先给结论再解释」「我是前端工程师，代码用 TypeScript」。
            </p>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value.slice(0, MAX_INSTRUCTIONS))}
              onBlur={commitInstructions}
              rows={4}
              placeholder="留空就是不加"
              className="settings-textarea"
              aria-label="自定义指令"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-faint">
              <span>离开输入框时自动保存</span>
              <span>
                {instructions.length} / {MAX_INSTRUCTIONS}
              </span>
            </div>
          </section>

          <section>
            <h3 className="settings-h">数据</h3>
            <p className="mb-2 text-[12px] leading-[1.6] text-muted">
              聊天记录只保存在这个浏览器里（IndexedDB）。发出的消息会经过服务器交给模型生成回答，服务器不保存聊天记录，只留 1 小时的输入日志用于排查故障。换设备或清理浏览器数据之前，先导出一份备份。
            </p>
            <div className="storage-meter">
              <HardDrives size={16} weight="bold" className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink">
                  {saved.length} 段会话 · 已用 {formatBytes(info?.usage ?? null)}
                  {info?.quota ? <span className="text-muted">（上限约 {formatBytes(info.quota)}）</span> : null}
                </div>
                {info?.usage != null && info.quota ? (
                  <div className="storage-meter__bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(1, Math.min(100, (info.usage / info.quota) * 100))}%` }} />
                  </div>
                ) : null}
                <div className="mt-1 text-[12px] text-muted">
                  {info?.persisted
                    ? '持久存储已开启：浏览器清理空间时不会删除这里的会话。'
                    : info?.persisted === false
                      ? '未开启持久存储：磁盘空间紧张时，浏览器可能自动清理这里的数据。'
                      : '这个浏览器不报告存储状态。'}
                </div>
              </div>
              {info?.persisted === false && (
                <button type="button" className="btn btn-ghost h-8 shrink-0 px-2.5 text-[12.5px]" onClick={() => void onPersist()}>
                  申请持久存储
                </button>
              )}
            </div>

            <Row title="导出时带上思考过程" hint="单段会话导出为 Markdown 时，把模型的思考过程放进可折叠块">
              <button
                type="button"
                role="switch"
                aria-checked={settings.exportReasoning}
                className={settings.exportReasoning ? 'switch is-on' : 'switch'}
                onClick={() => updateSettings({ exportReasoning: !settings.exportReasoning })}
              >
                <span />
              </button>
            </Row>

            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost settings-btn" onClick={() => void onExport()}>
                <DownloadSimple size={14} weight="bold" />
                导出全部（JSON）
              </button>
              <button type="button" className="btn btn-ghost settings-btn" onClick={() => fileRef.current?.click()}>
                <UploadSimple size={14} weight="bold" />
                从备份导入
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  void onImport(e.target.files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className={confirmClear ? 'btn settings-btn settings-btn--danger is-armed' : 'btn btn-ghost settings-btn settings-btn--danger'}
                onClick={() => void onClear()}
              >
                <Trash size={14} weight="bold" />
                {confirmClear ? '再点一次，确认清空' : '清空全部会话'}
              </button>
            </div>
          </section>

          <section>
            <h3 className="settings-h">快捷键</h3>
            <dl className="shortcut-list">
              {SHORTCUTS.map((s) => (
                <div key={s.keys}>
                  <dt>{s.what}</dt>
                  <dd>
                    <kbd className="kbd">{s.keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
