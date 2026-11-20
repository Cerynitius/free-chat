import type { AppGet, AppSet, Settings, SettingsSlice } from './types'
import {
  BUILTIN_PROXY_URL,
  DEFAULT_BASE_URL,
  describeConnectionError,
  fetchModels,
  pingProxy,
  resolveApiConfig,
} from '@/lib/api'

export const DEFAULT_SETTINGS: Settings = {
  mode: 'proxy',
  baseUrl: DEFAULT_BASE_URL,
  proxyUrl: BUILTIN_PROXY_URL,
  apiKey: '',
  model: 'dsv4-flash',
  effort: 'low',
  temperature: 0.7,
  topP: 1,
  maxTokens: 4096,
  systemPrompt: '',
  theme: 'system',
  fontSize: 'md',
}

export const settingsSlice = (set: AppSet, get: AppGet): SettingsSlice => ({
  settings: { ...DEFAULT_SETTINGS },
  connection: { status: 'idle' },

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  resetSettings: () =>
    set({ settings: { ...DEFAULT_SETTINGS, proxyUrl: BUILTIN_PROXY_URL } }),

  /**
   * 连接测试。顺便做两件事：
   *   1. 代理模式下先探 /__ping，拿到「代理自己有没有配置 key」——
   *      这决定后续聊天要不要在浏览器侧带 Authorization。
   *   2. 把失败翻译成人话，而不是甩一句 "Failed to fetch"。
   */
  testConnection: async () => {
    const { settings } = get()
    set({ connection: { status: 'testing' } })

    const cfg = resolveApiConfig(settings)
    if (!cfg.baseUrl) {
      set({
        connection: {
          status: 'error',
          message: '还没填地址 —— 先在下面选一种连接方式：本地代理、Cloudflare Worker，或直连源站。',
          at: Date.now(),
        },
      })
      return
    }

    const t0 = performance.now()
    try {
      let proxyHasKey: boolean | undefined
      if (cfg.mode === 'proxy') {
        const ping = await pingProxy(cfg)
        proxyHasKey = ping?.hasKey
      }

      const models = await fetchModels(cfg)
      const latencyMs = Math.round(performance.now() - t0)

      set({
        connection: {
          status: 'ok',
          latencyMs,
          models,
          proxyHasKey,
          at: Date.now(),
          message:
            cfg.mode === 'proxy' && proxyHasKey === false
              ? '已连上。代理侧没有配置 API key —— 聊天请求会用浏览器里的 key（若为空则无法鉴权）。'
              : undefined,
        },
      })
    } catch (err) {
      set({
        connection: {
          status: 'error',
          message: describeConnectionError(err, cfg.mode),
          at: Date.now(),
        },
      })
    }
  },
})
