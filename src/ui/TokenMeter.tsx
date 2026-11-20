import { formatTokens } from '@/lib/tokens'

interface Props {
  used: number
  limit: number
}

export function TokenMeter({ used, limit }: Props): React.ReactElement | null {
  if (!limit || limit <= 0) return null
  const pct = Math.min(100, (used / limit) * 100)
  return (
    <div className="flex items-center gap-2" title="上下文用量（客户端估算）">
      <div className="h-1 w-16 overflow-hidden rounded-pill bg-surface-2">
        <div className="h-full rounded-pill bg-muted" style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%` }} />
      </div>
      <span className="font-mono text-[11px] text-faint">约 {formatTokens(used)}</span>
    </div>
  )
}