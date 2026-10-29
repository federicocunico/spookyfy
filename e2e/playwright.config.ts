import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;
/** Gateway della modalità client (dev server: stessi handler delle funzioni Vercel). */
const CLIENT_PORT = 4174;
export const CLIENT_URL = `http://localhost:${CLIENT_PORT}`;
const root = path.resolve(import.meta.dirname, '..');
const data = path.join(import.meta.dirname, '.data');
/** MusicBrainz, Cover Art Archive e iTunes finti (fake-music.mjs). */
const MUSIC_PORT = 4599;
const MUSIC_URL = `http://127.0.0.1:${MUSIC_PORT}`;
const LOOKUP_ENV = {
  LOOKUP_MUSICBRAINZ_URL: `${MUSIC_URL}/mb`,
  LOOKUP_COVERART_URL: `${MUSIC_URL}/caa`,
  LOOKUP_ITUNES_URL: `${MUSIC_URL}/itunes`,
  LOOKUP_IMAGE_HOSTS: MUSIC_URL,
};

/**
 * Test end-to-end sul build di produzione della PWA:
 * - modalità on-premise: il server Fastify serve PWA e API, con lo yt-dlp finto;
 * - modalità client: il dev server del gateway (KV in memoria, YouTube finto),
 *   con il server on-premise come ponte d'importazione.
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
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    // auth.spec.ts gira in entrambe le modalità.
    {
      name: 'chromium',
      testMatch: /[\\/](app|auth|albums)\.spec\.ts$/,
      use: { ...devices['Pixel 7'], baseURL: BASE_URL },
    },
    {
      name: 'webkit',
      testMatch: /[\\/](app|auth|albums)\.spec\.ts$/,
      use: { ...devices['iPhone 14'], baseURL: BASE_URL },
    },
    {
      name: 'client-chromium',
      testMatch: /[\\/](client|auth|client-albums)\.spec\.ts$/,
      use: { ...devices['Pixel 7'], baseURL: CLIENT_URL },
    },
    {
      name: 'client-webkit',
      testMatch: /[\\/](client|auth|client-albums)\.spec\.ts$/,
      use: { ...devices['iPhone 14'], baseURL: CLIENT_URL },
    },
  ],
  webServer: [
    {
      command: `node "${path.join(import.meta.dirname, 'fake-music.mjs')}"`,
      url: `${MUSIC_URL}/health`,
      reuseExistingServer: false,
      timeout: 10_000,
      env: { PORT: String(MUSIC_PORT) },
    },
    {
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
        // Il gateway di test può usare questo server come ponte.
        BRIDGE_ALLOWED_ORIGINS: CLIENT_URL,
        LOG_LEVEL: 'warn',
        ...LOOKUP_ENV,
      },
    },
    {
      command: `pnpm --dir "${path.join(root, 'apps/gateway')}" exec tsx dev-server.ts`,
      url: `${CLIENT_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(CLIENT_PORT), NODE_ENV: 'development', ...LOOKUP_ENV },
    },
  ],
});
