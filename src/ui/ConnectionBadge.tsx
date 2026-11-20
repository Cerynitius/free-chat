import { useApp } from '@/state/store'

interface Props {
  onClick: () => void
}

export function ConnectionBadge({ onClick }: Props): React.ReactElement {
  const connection = useApp((s) => s.connection)

  const map = {
    idle: { text: '未测试', color: 'bg-faint' },
    testing: { text: '连接中', color: 'bg-yellow-ink' },
    ok: { text: '已连接', color: 'bg-green-ink' },
    error: { text: '连接失败', color: 'bg-red-ink' },
  } as const

  const s = map[connection.status]

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      title={connection.message ?? '点击打开设置'}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.color}`} />
      <span className="hidden sm:inline">{s.text}</span>
      {connection.latencyMs !== undefined && connection.status === 'ok' && (
        <span className="font-mono text-[11px] text-faint">{connection.latencyMs}ms</span>
      )}
    </button>
  )
}
