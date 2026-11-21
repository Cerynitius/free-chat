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

/**
 * 思考和正文**共用**这一个预算 —— 上游把 reasoning_content 也算进 max_tokens。
 *
 * 4096 在开思考的时候根本不够：实测一次高强度思考就把 4096 吃光，
 * 正文一个 token 都没轮到，流以 finish_reason=length 结束 —— 看着像
 * 「思考到一半断了」。
 *
 * 上游对这个值来者不拒：131072、262144 都照收，连拿它跟上下文长度对照
 * 也不查（15 万字提示词 + 131072 照样 200）。它是天花板，不是目标 ——
 * 同一道题在更大天花板下写出来的文章反而更短，因为模型写多少是它自己定的。
 */
export const MAX_TOKENS = 131072

/**
 * 系统提示词。
 *
 * 只讲工具怎么用 —— 语气、格式、身份都不在这儿管，
 * 那些是界面和默认参数的事。
 */
export const SYSTEM_PROMPT = [
  '你可以使用工具。工具说明随请求一起给你：',
  '- web_search 搜网页，web_fetch 抓某个网页的正文',
  '- read_file 读用户上传的文件（文本、PDF、Word、Excel、PPT），ocr 认图片里的字',
  '',
  '需要网上的信息、或者用户给了文件时，就调工具 —— 工具拿到的比你记忆里的准。',
  '用了搜索或抓取的结果时，在回答里把来源链接写出来。',
  '工具回了「搜不了」「读不了」这类话，就如实告诉用户，别自己编一个答案。',
].join('\n')