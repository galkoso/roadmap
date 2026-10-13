import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4200', viewport: { width: 1440, height: 1050 }, trace: 'retain-on-failure' },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: { command: 'pnpm preview', url: 'http://127.0.0.1:4200', reuseExistingServer: !process.env['CI'], timeout: 30000 }
});
