import { useEffect, useRef, useState } from 'react'

/**
 * 把一个变化很快的值节流成「每 delay 毫秒最多更新一次」。
 *
 * 流式输出时每个 delta 都会触发一次 React 更新 —— 消息树一大就卡。
 * 这里只节流**渲染**这一层，状态本身仍然是实时的（贴底判断不受影响）。
 */
export function useThrottledValue<T>(value: T, delay = 80): T {
  const [throttled, setThrottled] = useState(value)
  const last = useRef(value)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (value === last.current) return
    last.current = value
    if (timer.current !== null) return
    timer.current = window.setTimeout(() => {
      timer.current = null
      setThrottled(value)
    }, delay)
  }, [value, delay])

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  return throttled
}
