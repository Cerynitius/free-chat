import type { AppSet, Settings, SettingsSlice } from './types'
import { DEFAULT_EFFORT } from '@/config'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  effort: DEFAULT_EFFORT,
  tools: true,
  fontSize: 'md',
  sendKey: 'enter',
  instructions: '',
  exportReasoning: false,
}

export const settingsSlice = (set: AppSet): SettingsSlice => ({
  settings: { ...DEFAULT_SETTINGS },

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

})