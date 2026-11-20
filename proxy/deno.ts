/**
 * Deno Deploy 入口。
 *
 * Deno Deploy 会把平台上的环境变量注入到 fetch 的第二个参数，handler.js 会
 * 自动把它和 Deno.env 合并，所以这里不需要额外处理。
 */
import { handleRequest } from './handler.js'

export default {
  fetch: handleRequest,
}
