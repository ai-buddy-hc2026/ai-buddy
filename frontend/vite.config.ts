/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

const DEFAULT_PROXY_TARGET = 'http://localhost:8080'

export default defineConfig(({ mode }) => {
  // VITE_PROXY_TARGET читается из .env*, чтобы dev-прокси знал адрес Go API
  const env = loadEnv(mode, process.cwd(), '')
  // /api/* -> Go API без префикса: браузер ходит на свой origin, CORS не нужен.
  // SSE (/api/chat/stream/{id}) проходит через тот же прокси без буферизации.
  const proxy: Record<string, ProxyOptions> = {
    '/api': {
      target: env.VITE_PROXY_TARGET || DEFAULT_PROXY_TARGET,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  }

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // host: true - слушать все интерфейсы (нужно для Docker и для 127.0.0.1 на Windows)
    server: { port: 3000, host: true, proxy },
    preview: { proxy },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      css: false,
    },
  }
})
