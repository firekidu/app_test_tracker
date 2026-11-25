import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// End-to-end tests run against DEMO mode (in-memory copy of the fixture sheet, local-disk "Drive"),
// so they need no Google account. Run: npm run build && npm run test:e2e
const port = 3200;
const dataDir = path.join(os.tmpdir(), `smprd-e2e-${Date.now()}`);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'off' },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      APP_URL: `http://127.0.0.1:${port}`,
      DATA_DIR: dataDir,
      DEMO_SHEET_CSV: path.resolve('tests/fixtures/sheet-2026-11-24.csv'),
      INITIAL_ADMIN_USERNAME: 'david',
      INITIAL_ADMIN_PASSWORD: 'temporary admin pass 2026',
      BETTER_AUTH_SECRET: 'e2e-only-secret-e2e-only-secret-1234',
      ENCRYPTION_KEY: 'e2e-only-key',
      TZ: 'Europe/London',
    },
  },
});
