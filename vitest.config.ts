import path from 'node:path';
import os from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    env: {
      DATA_DIR: path.join(os.tmpdir(), `smprd-test-${process.pid}`),
      DEMO_SHEET_CSV: path.resolve(__dirname, 'tests/fixtures/sheet-2026-11-24.csv'),
      TZ: 'Europe/London',
      ENCRYPTION_KEY: 'test-key-test-key-test-key-test-key',
    },
  },
});
