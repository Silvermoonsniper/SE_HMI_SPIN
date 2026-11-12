import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    browserName: process.env.PLAYWRIGHT_BROWSER === 'firefox' ? 'firefox' : 'chromium',
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
  },
})
