import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ★ **相对路径**：GitHub Pages 把它挂在 /仓库名/ 这样的子路径下，
  //   写死 '/仓库名/' 的话 fork 出去就全 404；'./' 的话同一份 dist/
  //   在 Pages、任何静态服务器、甚至局域网共享文件夹里都能直接跑 ✓
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5173, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
})
