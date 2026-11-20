import { useEffect } from 'react'
import { WarningCircle, CheckCircle, Info, X } from '@phosphor-icons/react'
import { useApp } from '@/state/store'

export function Toast(): React.ReactElement | null {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)

  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map((t) =>
      window.setTimeout(() => dismiss(t.id), t.tone === 'error' ? 8000 : 4000),
    )
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [toasts, dismiss])

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="panel pointer-events-auto flex items-start gap-2 px-3 py-2.5 text-[13px] text-ink-2"
        >
          <span className="mt-0.5 shrink-0">
            {t.tone === 'ok' ? (
              <CheckCircle size={16} weight="fill" className="text-green-ink" />
            ) : t.tone === 'error' ? (
              <WarningCircle size={16} weight="fill" className="text-red-ink" />
            ) : t.tone === 'warn' ? (
              <WarningCircle size={16} weight="fill" className="text-yellow-ink" />
            ) : (
              <Info size={16} weight="fill" className="text-blue-ink" />
            )}
          </span>
          <span className="min-w-0 flex-1">{t.text}</span>
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => dismiss(t.id)} aria-label="关闭">
            <X size={13} weight="bold" />
          </button>
        </div>
      ))}
    </div>
  )
}