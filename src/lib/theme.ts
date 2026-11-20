/**
 * 主题解析。
 *
 * Tailwind v4 没有内置的 dark 策略，这里用的是 class 策略（class 挂在 <html> 上），
 * 所以「跟随系统」必须由 JS 解析成 light/dark 再写进 class —— CSS 层面做不到这件事。
 */

import type { ThemeMode } from '@/state/types'

export type ResolvedTheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** 系统当前是不是深色 */
export function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches
}

/** 把设置里的模式解析成实际生效的主题 */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return prefersDark() ? 'dark' : 'light'
}

/** 把实际主题写到 <html> 的 class 上 —— dark 变体靠这个 class 生效 */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', resolveTheme(mode) === 'dark')
}