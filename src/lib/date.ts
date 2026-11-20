/** 会话按日期分组：今天 / 昨天 / 本周 / 更早 */

export type DateGroup = '今天' | '昨天' | '本周' | '更早'

const DAY = 24 * 60 * 60 * 1000

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function groupOf(ts: number, now = Date.now()): DateGroup {
  const today = startOfDay(now)
  const day = startOfDay(ts)
  const diffDays = Math.round((today - day) / DAY)
  if (diffDays <= 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return '本周'
  return '更早'
}

/** 列表用的短时间：今天显示 HH:mm，更早显示 MM-DD */
export function formatTime(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (groupOf(ts, now) === '今天') return `${hh}:${mm}`
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mo}-${dd}`
}

/** 导出文件名用：20261120-1534 */
export function stamp(ts = Date.now()): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
