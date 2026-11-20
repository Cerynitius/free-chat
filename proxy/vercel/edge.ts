/**
 * Vercel Edge Functions 入口。
 *
 * Vercel Edge 不注入 env 对象，环境变量走 process.env —— handler.js 会自动读，
 * 所以这里只需要把处理函数原样导出。
 *
 * 两个 runtime 导出都留着：Next.js 认 `runtime`，独立 Vercel 项目认 `config`。
 */
import { handleRequest } from '../handler.js'

export const runtime = 'edge'
export const config = { runtime: 'edge' }

export default handleRequest
