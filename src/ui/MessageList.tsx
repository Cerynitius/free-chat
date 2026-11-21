import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Conversation, Message } from '@/state/types'
import { useApp } from '@/state/store'
import { MessageItem } from './MessageItem'
import { ScrollToBottom } from './ScrollToBottom'

interface Props {
  conversation: Conversation | undefined
  onEdit: (message: Message) => void
}

export function MessageList({ conversation, onEdit }: Props): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const atBottom = useApp((s) => s.atBottom)
  const setAtBottom = useApp((s) => s.setAtBottom)
  const setUnread = useApp((s) => s.setUnread)
  const unread = useApp((s) => s.unread)
  const streamingId = useApp((s) => s.streamingId)
  const regenerate = useApp((s) => s.regenerate)

  /** 还跟着流走吗 —— 用户一往上滑就暂停 */
  const followRef = useRef(true)
  const lastTopRef = useRef(0)

  const messages = conversation?.messages ?? []
  const last = messages[messages.length - 1]
  const count = messages.length

  /**
   * 新的一轮 ⇒ 直接跳到底部。
   *
   * 用户刚发了消息、或者模型刚开始答 —— 这时候不跳，他得自己找。
   */
  useLayoutEffect(() => {
    if (count === 0) return
    followRef.current = true
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setAtBottom(true)
    setUnread(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count])

  /**
   * 内容在长 ⇒ 视窗钉在最后一行。
   *
   * 贴着底部时跟着流走；用户往上滑了就别跟他抢 —— 抢了他根本读不了。
   */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !followRef.current) return
    el.scrollTop = el.scrollHeight
  }, [last?.content, last?.reasoning])

  // 没跟着的时候，数一数又来了多少新内容
  useEffect(() => {
    if (!last?.content) return
    if (followRef.current) return
    if (!streamingId) return
    setUnread(unread + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.content])

  const onScroll = (): void => {
    if (rafRef.current !== null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      const el = scrollRef.current
      if (!el) return
      const top = el.scrollTop
      const bottom = top + el.clientHeight >= el.scrollHeight - 32

      if (top < lastTopRef.current - 1) {
        // 用户往上滑了 ⇒ 暂停跟随
        followRef.current = false
        setAtBottom(false)
      } else if (bottom) {
        // 滑回底部 ⇒ 恢复跟随
        followRef.current = true
        setAtBottom(true)
        setUnread(0)
      }
      lastTopRef.current = top
    })
  }

  const scrollToBottom = (): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    followRef.current = true
    setAtBottom(true)
    setUnread(0)
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain px-4 py-6 sm:px-6"
        /* 别让浏览器的滚动锚定跟我们抢位置 —— 那是自动跟随的头号对头 */
        style={{ overflowAnchor: 'none' }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-7">
          {messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              streaming={m.id === streamingId}
              onRegenerate={() => void regenerate(m.id)}
              onEdit={onEdit}
            />
          ))}
        </div>
      </div>
      <ScrollToBottom visible={!atBottom} unread={unread} onClick={scrollToBottom} />
    </div>
  )
}
