import { useEffect, useState } from 'react'
import { ArrowCounterClockwise, Pulse, X } from '@phosphor-icons/react'
import { useApp } from '@/state/store'
import type { FontSize, ThemeMode } from '@/state/types'
import { pingProxy, resolveApiConfig } from '@/lib/api'
import { EffortPicker } from './EffortPicker'

interface Props {
  open: boolean
  onClose: () => void
}

/** 一个分区 */
function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="mb-6 last:mb-0">
      <h2 className="mb-2.5 text-[11px] uppercase tracking-[0.14em] text-faint">{title}</h2>
      {children}
    </section>
  )
}

/** 分段选择器 —— 选中项用 canvas 底色，在明暗两套配色下都读得出来 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): React.ReactElement {
  return (
    <div className="flex gap-1 rounded-md border border-line bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={[
            'flex-1 rounded-xs px-2 py-1 text-[12px] transition-colors',
            o.value === value
              ? 'bg-canvas font-medium text-ink'
              : 'text-muted hover:text-ink',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * 数字输入。
 *
 * 用本地字符串做受控值 —— 直接把 number 绑到 input 上，用户清空的那一瞬间
 * 会立刻被 0 顶回去，根本没法输入。
 */
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  hint?: string
}): React.ReactElement {
  const [raw, setRaw] = useState(() => String(value))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setRaw(String(value))
  }, [value, editing])

  const commit = (text: string): void => {
    if (text.trim() === '') return
    const n = Number(text)
    if (Number.isNaN(n)) return
    onChange(Math.min(max, Math.max(min, n)))
  }

  return (
    <div>
      <label className="field-label">{label}</label>
      <input
        className="field"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={raw}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setRaw(e.target.value)
          commit(e.target.value)
        }}
        onBlur={() => {
          // 失焦后由上面的 effect 把 raw 拉回真实值（此时拿到的 value 才是最新的）
          setEditing(false)
        }}
      />
      {hint && <p className="mt-1 text-[11px] leading-[1.5] text-faint">{hint}</p>}
    </div>
  )
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

const FONT_OPTIONS: { value: FontSize; label: string }[] = [
  { value: 'sm', label: '小' },
  { value: 'md', label: '中' },
  { value: 'lg', label: '大' },
]

export function SettingsPanel({ open, onClose }: Props): React.ReactElement | null {
  const settings = useApp((s) => s.settings)
  const connection = useApp((s) => s.connection)
  const updateSettings = useApp((s) => s.updateSettings)
  const resetSettings = useApp((s) => s.resetSettings)
  const testConnection = useApp((s) => s.testConnection)

  const [ping, setPing] = useState<{ ok: boolean; text: string } | null>(null)
  const [pinging, setPinging] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const supportedEfforts = connection.models?.[0]?.supported_reasoning_efforts ?? []

  const onPing = async (): Promise<void> => {
    setPinging(true)
    setPing(null)
    try {
      const r = await pingProxy(resolveApiConfig(settings))
      if (!r) {
        setPing({
          ok: false,
          text: '没收到 /__ping 的响应 —— 地址可能填错了，或者那不是本项目的代理。',
        })
      } else if (!r.reachable) {
        setPing({
          ok: false,
          text: `代理在，但连不上源站${r.error ? '：' + r.error : '。'}`,
        })
      } else {
        setPing({
          ok: true,
          text: `代理正常 · 上游可达 · 往返 ${r.latencyMs}ms${
            r.hasKey ? ' · 代理已配置 API key' : ' · 代理未配置 API key'
          }`,
        })
      }
    } finally {
      setPinging(false)
    }
  }

  const onReset = (): void => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    resetSettings()
    setConfirmReset(false)
    setPing(null)
  }

  if (!open) return null

  const connText =
    connection.status === 'idle'
      ? '还没测过'
      : connection.status === 'testing'
        ? '测试中…'
        : connection.status === 'ok'
          ? `已连接 · ${connection.latencyMs ?? '?'}ms · ${connection.models?.length ?? 0} 个模型`
          : '连接失败'

  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />

      <aside className="drawer" role="dialog" aria-label="设置">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="font-serif text-[16px] tracking-[-0.01em] text-ink">设置</span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="关闭设置"
            title="关闭"
          >
            <X size={15} weight="bold" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Section title="连接方式">
            <div className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-3 py-2">
                <input
                  type="radio"
                  name="conn-mode"
                  className="mt-0.5 accent-ink"
                  checked={settings.mode === 'proxy'}
                  onChange={() => updateSettings({ mode: 'proxy' })}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">代理</span>
                  <span className="block text-[11px] leading-[1.5] text-muted">
                    走自己控制的转发层 —— key 留在服务端，浏览器拿不到。
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-3 py-2">
                <input
                  type="radio"
                  name="conn-mode"
                  className="mt-0.5 accent-ink"
                  checked={settings.mode === 'direct'}
                  onChange={() => updateSettings({ mode: 'direct' })}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">直连源站</span>
                  <span className="block text-[11px] leading-[1.5] text-muted">
                    源站必须开了 CORS，否则浏览器连预检都过不去。
                  </span>
                </span>
              </label>
            </div>
          </Section>

          <Section title="代理地址">
            <input
              className="field"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="http://127.0.0.1:8787"
              value={settings.proxyUrl}
              onChange={(e) => updateSettings({ proxyUrl: e.target.value })}
            />
            <p className="mt-1 text-[11px] leading-[1.5] text-faint">
              本地代理填 http://127.0.0.1:8787；Cloudflare Worker 填 https://xxx.workers.dev
            </p>
          </Section>

          {settings.mode === 'direct' && (
            <Section title="源站地址">
              <input
                className="field"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://182.92.245.176:1920"
                value={settings.baseUrl}
                onChange={(e) => updateSettings({ baseUrl: e.target.value })}
              />
            </Section>
          )}

          <Section title="API Key">
            <input
              className="field"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-…"
              value={settings.apiKey}
              onChange={(e) => updateSettings({ apiKey: e.target.value })}
            />
            <p className="mt-1 text-[11px] leading-[1.5] text-faint">
              代理模式下 key 存在代理侧，浏览器可以留空 —— 留空时请求根本不带
              Authorization。只有代理自检报「未配置 key」时才需要填。
            </p>
          </Section>

          <Section title="模型">
            <input
              className="field"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="dsv4-flash"
              value={settings.model}
              onChange={(e) => updateSettings({ model: e.target.value })}
            />
          </Section>

          <Section title="思考档位">
            <EffortPicker
              value={settings.effort}
              onChange={(v) => updateSettings({ effort: v })}
              supported={supportedEfforts}
            />
          </Section>

          <Section title="采样参数">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="temperature"
                value={settings.temperature}
                min={0}
                max={2}
                step={0.1}
                onChange={(v) => updateSettings({ temperature: v })}
              />
              <NumberField
                label="top_p"
                value={settings.topP}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => updateSettings({ topP: v })}
              />
            </div>
            <div className="mt-3">
              <NumberField
                label="max_tokens"
                value={settings.maxTokens}
                min={1}
                max={131072}
                step={1}
                onChange={(v) => updateSettings({ maxTokens: Math.round(v) })}
              />
            </div>
          </Section>

          <Section title="系统提示词">
            <textarea
              className="field resize-y"
              rows={5}
              placeholder="每次对话都会带上这段提示词。留空则不带。"
              value={settings.systemPrompt}
              onChange={(e) => updateSettings({ systemPrompt: e.target.value })}
            />
          </Section>

          <Section title="外观">
            <div className="flex flex-col gap-3">
              <div>
                <label className="field-label">主题</label>
                <Segmented
                  value={settings.theme}
                  options={THEME_OPTIONS}
                  onChange={(v) => updateSettings({ theme: v })}
                />
              </div>
              <div>
                <label className="field-label">字号</label>
                <Segmented
                  value={settings.fontSize}
                  options={FONT_OPTIONS}
                  onChange={(v) => updateSettings({ fontSize: v })}
                />
              </div>
            </div>
          </Section>

          <Section title="连接测试">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn"
                onClick={() => void testConnection()}
                disabled={connection.status === 'testing'}
              >
                <Pulse size={14} weight="bold" />
                {connection.status === 'testing' ? '测试中…' : '测试连接'}
              </button>

              {settings.mode === 'proxy' && (
                <button type="button" className="btn" onClick={() => void onPing()} disabled={pinging}>
                  {pinging ? '自检中…' : '代理自检'}
                </button>
              )}
            </div>

            <div className="mt-2 text-[12px] leading-[1.6] text-muted">
              {connection.status === 'error' ? (
                <span className="text-red-ink">{connection.message}</span>
              ) : (
                <span>{connText}</span>
              )}
            </div>

            {ping && (
              <div
                className={`mt-1.5 text-[12px] leading-[1.6] ${
                  ping.ok ? 'text-green-ink' : 'text-red-ink'
                }`}
              >
                {ping.text}
              </div>
            )}
          </Section>
        </div>

        <footer className="border-t border-line px-4 py-3">
          <button
            type="button"
            className="btn w-full"
            onClick={onReset}
            onBlur={() => setConfirmReset(false)}
          >
            <ArrowCounterClockwise size={14} weight="bold" />
            {confirmReset ? '再点一次确认恢复' : '恢复默认设置'}
          </button>
        </footer>
      </aside>
    </>
  )
}