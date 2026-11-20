import { ArrowDown } from '@phosphor-icons/react'

interface Props {
  visible: boolean
  unread: number
  onClick: () => void
}

export function ScrollToBottom({ visible, unread, onClick }: Props): React.ReactElement | null {
  if (!visible) return null
  return (
    <button type="button" onClick={onClick} className="fab" aria-label="回到底部">
      <ArrowDown size={14} weight="bold" />
      {unread > 0 && <span className="font-mono text-[11px] text-muted">+{unread}</span>}
    </button>
  )
}
