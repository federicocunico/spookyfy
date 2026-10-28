import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;
const root = path.resolve(import.meta.dirname, '..');
const data = path.join(import.meta.dirname, '.data');

/**
 * Test end-to-end sul build di produzione: il server Fastify serve la PWA e
 * l'API dalla stessa origine, con lo yt-dlp finto dei test del server.
 * Prerequisito: `pnpm build` (lo esegue `pnpm test:e2e` dalla radice).
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
    { name: 'webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: `node "${path.join(import.meta.dirname, 'start-server.mjs')}"`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      PUBLIC_ORIGIN: BASE_URL,
      DATA_DIR: path.join(data, 'db'),
      MEDIA_DIR: path.join(data, 'media'),
      WEB_DIST_DIR: path.join(root, 'apps/web/dist'),
      // Solo per i test: http://localhost non può usare cookie Secure su tutti i browser.
      COOKIE_SECURE: 'false',
      TRUST_CF_HEADERS: 'false',
      YTDLP_NODE_SCRIPT: path.join(root, 'apps/server/test/fixtures/fake-ytdlp.mjs'),
      INGEST_CONCURRENCY: '2',
      LOG_LEVEL: 'warn',
    },
  },
});
