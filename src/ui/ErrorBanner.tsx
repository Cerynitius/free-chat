import { WarningCircle, ArrowClockwise, X } from '@phosphor-icons/react'

interface Props {
  message: string
  hint?: string
  onRetry?: () => void
  onDismiss?: () => void
}

export function ErrorBanner({ message, hint, onRetry, onDismiss }: Props): React.ReactElement {
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-soft bg-red-soft/50 px-3 py-2.5 text-[13px] text-red-ink">
      <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="break-words">{message}</div>
        {hint && <div className="mt-1 opacity-85">{hint}</div>}
      </div>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-icon" onClick={onRetry} aria-label="重试">
          <ArrowClockwise size={15} weight="bold" />
        </button>
      )}
      {onDismiss && (
        <button type="button" className="btn btn-ghost btn-icon" onClick={onDismiss} aria-label="关闭">
          <X size={13} weight="bold" />
        </button>
      )}
    </div>
  )
}