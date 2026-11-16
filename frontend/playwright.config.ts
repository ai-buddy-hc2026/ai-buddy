import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  projects: [
    {
      name: 'api',
      testMatch: 'scenarios.spec.ts',
      use: { baseURL: process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8080' },
    },
    {
      name: 'ui',
      testMatch: 'ui.spec.ts',
      use: {
        baseURL: 'http://127.0.0.1:3000',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 3000 --strictPort',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    env: {
      VITE_API_BASE_URL: '/api',
      VITE_PROXY_TARGET: process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8080',
    },
  },
})
