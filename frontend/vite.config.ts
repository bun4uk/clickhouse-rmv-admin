import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server proxies /api to the backend so the app uses same-origin calls
// (matches production behind nginx). Override target with VITE_API_TARGET.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 3000,
    proxy: {
      '/api': {
        target:
          (globalThis as { process?: { env?: Record<string, string> } }).process?.env
            ?.VITE_API_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
