import { defineConfig, devices } from '@playwright/test';

/**
 * Verifica dal browser di un deploy pubblicato (nessun server locale): registrazione,
 * sessione, ricerca e nuovo accesso come su iPhone (WebKit) e Android (Chromium).
 *
 *   VERIFY_REGISTRATION_TOKEN=… pnpm verify:prod:ui
 *   SPOOKYFY_URL=https://<progetto>.vercel.app VERIFY_REGISTRATION_TOKEN=… pnpm verify:prod:ui
 *
 * Gli account di prova vengono eliminati alla fine con la CLI del gateway (serve
 * REDIS_URL, da `vercel env pull apps/gateway/.env`). Vedi docs/verifica-deploy.md.
 */
export const REMOTE_URL = new URL(process.env.SPOOKYFY_URL ?? 'https://spookyfy-ten.vercel.app').origin;

export default defineConfig({
  testDir: './remote',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: REMOTE_URL, trace: 'retain-on-failure', serviceWorkers: 'allow' },
  projects: [
    { name: 'remote-iphone', use: { ...devices['iPhone 14'] } },
    { name: 'remote-android', use: { ...devices['Pixel 7'] } },
  ],
});
