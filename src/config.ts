import type { ReasoningEffort } from '@/state/types'

/**
 * 这个应用是给 dsv4-flash（破甲版）专用的 —— 参数全部写死在这里，
 * 界面上不再做通用 API 配置，也没有「连哪个后端」这种选择。
 *
 * 换模型/换服务 = 改这个文件，不是改设置面板。
 */

/** 源站。只能 https —— 它的 1920 端口不接明文。 */
export const BASE_URL = 'https://182.92.245.176:1920'

/**
 * 代理地址（可选）。
 *
 * 源站一个 CORS 头都不返，浏览器直连会被同源策略拦掉 —— 所以正式部署时
 * 需要在自己这一侧放一层代理（仓库里的 proxy/ 就是干这个的），把地址填到
 * 构建期的 VITE_PROXY_URL 里，访客打开就是能用的状态。
 *
 * 本地开发默认指向 npm run proxy 起的那个，clone 下来直接就能跑。
 */
export const PROXY_URL = (
  import.meta.env.VITE_PROXY_URL ?? (import.meta.env.DEV ? 'http://127.0.0.1:8787' : '')
).trim()

/** API key。构建期注入（仓库里没有真值）；代理模式下由代理侧覆盖。 */
export const API_KEY = (import.meta.env.VITE_API_KEY ?? '').trim()

export const MODEL = 'dsv4-flash'

export const DEFAULT_EFFORT: ReasoningEffort = 'low'

export const TEMPERATURE = 0.7
export const TOP_P = 1
export const MAX_TOKENS = 4096
export const SYSTEM_PROMPT = ''