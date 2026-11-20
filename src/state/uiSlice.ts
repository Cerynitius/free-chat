import type { AppSet, UiSlice } from './types'

export const uiSlice = (set: AppSet): UiSlice => ({
  sidebarOpen: false,
  atBottom: true,
  unread: 0,
  toasts: [],

  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setAtBottom: (v) => set({ atBottom: v }),
  setUnread: (v) => set({ unread: v }),

  pushToast: (t) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        { ...t, id: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`, at: Date.now() },
      ],
    })),

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
})