import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Conversation } from '@/state/types'
import { useApp } from '@/state/store'
import { MessageItem } from './MessageItem'
import { ScrollToBottom } from './ScrollToBottom'

interface Props {
  conversation: Conversation | undefined
}

export function MessageList({ conversation }: Props): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const atBottom = useApp((s) => s.atBottom)
  const setAtBottom = useApp((s) => s.setAtBottom)
  const setUnread = useApp((s) => s.setUnread)
  const unread = useApp((s) => s.unread)
  const streamingId = useApp((s) => s.streamingId)
  const regenerate = useApp((s) => s.regenerate)

  const messages = conversation?.messages ?? []
  const last = messages[messages.length - 1]

  // 贴底时跟着流走；不贴底就不动，只累计未读数
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !atBottom) return
    el.scrollTop = el.scrollHeight
  }, [last?.content, last?.reasoning, atBottom])

  useEffect(() => {
    if (atBottom) return
    if (streamingId) setUnread(unread + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.content])

  const onScroll = (): void => {
    if (rafRef.current !== null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      const el = scrollRef.current
      if (!el) return
      const bottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80
      setAtBottom(bottom)
      if (bottom) setUnread(0)
    })
  }

  const scrollToBottom = (): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setAtBottom(true)
    setUnread(0)
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain px-4 py-6 sm:px-6"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-7">
          {messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              streaming={m.id === streamingId}
              onRegenerate={() => void regenerate(m.id)}
            />
          ))}
        </div>
      </div>
      <ScrollToBottom visible={!atBottom} unread={unread} onClick={scrollToBottom} />
    </div>
  )
}