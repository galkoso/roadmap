import { defineConfig } from '@playwright/test';
const port = Number(process.env['ROADMAP_TEST_PORT'] ?? 4200);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid test port');
const url = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: url, viewport: { width: 1440, height: 1050 }, trace: 'retain-on-failure' },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: { command: `ROADMAP_PREVIEW_PORT=${port} pnpm preview`, url, reuseExistingServer: !process.env['CI'], timeout: 30000 }
});
