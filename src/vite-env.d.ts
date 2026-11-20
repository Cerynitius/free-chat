/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 构建期注入的 API key。
   * 生产环境由 CI 从仓库 secret 注入；本地从 .env.local 读（不入库）。
   */
  readonly VITE_API_KEY?: string

  /**
   * 构建期注入的默认代理地址。
   * 仓库变量（不是 secret）—— 填了 Worker 地址，访客打开就是可用状态。
   */
  readonly VITE_PROXY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
