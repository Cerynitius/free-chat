import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/newsreader'
import 'katex/dist/katex.min.css'
import './styles.css'
import { App } from './App'
import { useApp } from '@/state/store'
import { applyTheme } from '@/lib/theme'

/**
 * 主题要在 React 挂载**之前**贴到 <html> 上。
 *
 * store 的 hydrate 是模块加载时的副作用，这里 import 完它就已经拿到持久化的设置，
 * 所以这一行能赶在首帧之前把 dark class 挂好 —— 否则深色用户会先看到一帧白底。
 */
applyTheme(useApp.getState().settings.theme)
// 界面风格和字号同理：首帧之前就定下来，不闪
document.documentElement.dataset.ui = useApp.getState().settings.uiStyle
document.documentElement.dataset.fontSize = useApp.getState().settings.fontSize

const container = document.getElementById('root')
if (!container) throw new Error('找不到 #root 挂载点')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)