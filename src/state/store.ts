import { create } from 'zustand'
import type { AppState } from './types'
import { settingsSlice } from './settingsSlice'
import { chatSlice } from './chatSlice'
import { uiSlice } from './uiSlice'
import { hydrate } from './persist'

export const useApp = create<AppState>()((set, get) => ({
  ...settingsSlice(set, get),
  ...chatSlice(set, get),
  ...uiSlice(set),
}))

// 启动时从 localStorage 恢复
hydrate(useApp)

// 调试钩子：加 ?debug=1 才挂，生产构建不暴露
if (new URLSearchParams(location.search).get('debug') === '1') {
  ;(window as unknown as { __chat?: typeof useApp }).__chat = useApp
}
