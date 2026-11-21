import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Brain, CaretDown, CaretRight, Check } from '@phosphor-icons/react'

interface Props {
  /** 思考正文 —— 流式追加，从底部进来 */
  text: string
  /** 思考还在进行中吗 —— 正文一开始就算结束 */
  thinking: boolean
  /** 思考耗时（ms）—— 思考结束时才有值 */
  elapsedMs?: number
}

/** 秒表：一位小数 */
function secs(ms: number): string {
  return (ms / 1000).toFixed(1)
}

/**
 * 思考中的秒表。
 *
 * 单独一个组件：它每 100ms 改一次 state，
 * 别把那一屏长文本拖进每秒十次的渲染里。
 */
function LiveSeconds({ since }: { since: number }): React.ReactElement {
  const [ms, setMs] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setMs(performance.now() - since), 100)
    return () => window.clearInterval(t)
  }, [since])
  return <>{secs(ms)} 秒</>
}

/**
 * 思考过程面板。
 *
 * 结构是三层：
 *   标题行（折叠态就只剩这一行）
 *   └ 视窗（高度锁死，顶部用遮罩柔化那条边界）
 *      └ 滚动层（内容在这里面往上滚）
 *
 * 粘底跟随的规矩：流式追加时视窗钉在最后一行；
 * 用户一往上滚就暂停跟随（否则自动滚动会跟他抢），
 * 右下角浮一个「回到最新」，滑回底部就自动恢复。
 */
export function ReasoningPanel({
  text,
  thinking,
  elapsedMs,
}: Props): React.ReactElement | null {
  // 展开态：思考时默认展开（要看着它一行行往上滚），想完了自动收成一行摘要
  const [open, setOpen] = useState(thinking)
  /** 用户上滑了 ⇒ 暂停粘底 */
  const [paused, setPaused] = useState(false)
  /** 内容比视窗高 ⇒ 顶部那条线要柔化 */
  const [overflowing, setOverflowing] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  /** 还跟着流走吗 */
  const followRef = useRef(true)
  const lastTopRef = useRef(0)
  const lastPinRef = useRef(0)
  /** 面板挂载 ≈ 第一个思考 token 落地 */
  const bornAtRef = useRef(performance.now())

  // 思考结束 ⇒ 自动降级到 L0（收成一行摘要）
  const wasThinkingRef = useRef(thinking)
  useEffect(() => {
    if (wasThinkingRef.current && !thinking) setOpen(false)
    wasThinkingRef.current = thinking
  }, [thinking])

  /**
   * 粘底跟随：新 token 从底部进来，视窗钉在最后一行。
   *
   * 这里是瞬时定位而不是 smooth —— 流式每 80ms 来一次，
   * 平滑滚动会被一次次打断，反而永远追不上。
   * 主动点「回到最新」才用 smooth（见 jumpToLatest）。
   */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // 内容比视窗高 ⇒ 顶部要渐隐
    setOverflowing(el.scrollHeight > el.clientHeight + 1)
    if (!thinking || !followRef.current) return
    const now = performance.now()
    if (now - lastPinRef.current < 60) return // 节流 60ms
    lastPinRef.current = now
    el.scrollTop = el.scrollHeight
  }, [text, thinking])

  // 展开的那一刻对齐到最后一行（打开的是一段正在长的东西）
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !open || !thinking || !followRef.current) return
    el.scrollTop = el.scrollHeight
  }, [open])

  /**
   * 文字变高 ⇒ 再贴一次底。
   *
   * 字体加载完、遮罩渐隐、面板高度过渡 —— 这些都会在算完 scrollHeight
   * **之后**又把内容撑高，视窗就停在半路上了。盯着文字本身的高度才准。
   */
  useEffect(() => {
    const el = scrollRef.current
    const content = textRef.current
    if (!el || !content) return
    const ro = new ResizeObserver(() => {
      if (!thinking || !followRef.current) return
      el.scrollTop = el.scrollHeight
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [thinking])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const top = el.scrollTop
    const atBottom = top + el.clientHeight >= el.scrollHeight - 4
    if (top < lastTopRef.current - 1) {
      // 用户往上滑 ⇒ 暂停跟随
      if (followRef.current) {
        followRef.current = false
        setPaused(true)
      }
    } else if (atBottom && !followRef.current) {
      // 自己滑回底部 ⇒ 恢复跟随
      followRef.current = true
      setPaused(false)
    }
    lastTopRef.current = top
  }

  /** 「回到最新」：这一次用平滑滚动 —— 是人点的，值得看它滑过去 */
  const jumpToLatest = (): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    followRef.current = true
    setPaused(false)
  }

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    if (!next) return
    const el = scrollRef.current
    if (!el) return
    // 展开 ⇒ 视窗对齐到最后一行（最新的一段）
    el.scrollTop = el.scrollHeight
    followRef.current = true
    setPaused(false)
  }

  if (!text.trim()) return null

  const label = thinking
    ? '思考中'
    : elapsedMs !== undefined
      ? `已思考 ${secs(elapsedMs)} 秒`
      : '思考过程'

  return (
    <div className="reasoning">
      <button
        type="button"
        className="reasoning__head flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-muted transition-colors hover:text-ink"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="reasoning__caret-icon">
          {open ? <CaretDown size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
        </span>
        <span className="reasoning__icon">
          <Brain size={15} weight="bold" />
        </span>
        <span className="tabular-nums">
          {thinking ? (
            <>
              思考中 <LiveSeconds since={bornAtRef.current} />
            </>
          ) : (
            label
          )}
        </span>
        {thinking ? (
          <span className="reasoning__dot" aria-hidden="true" />
        ) : (
          <Check size={13} weight="bold" className="reasoning__check" aria-hidden="true" />
        )}
      </button>

      <div
        className="reasoning__viewport"
        data-open={open ? 'true' : 'false'}
        data-fade={overflowing ? 'on' : 'off'}
      >
        <div ref={scrollRef} className="reasoning__scroll" onScroll={onScroll}>
          <div ref={textRef} className="reasoning__text">
            {text}
            {thinking && <span className="reasoning__caret" aria-hidden="true" />}
          </div>
        </div>
        {open && paused && (
          <button type="button" className="reasoning__jump" onClick={jumpToLatest}>
            回到最新
          </button>
        )}
      </div>
    </div>
  )
}
