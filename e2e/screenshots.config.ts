import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * Screenshot del README (`pnpm screenshots` dalla radice): stessi server dei test e2e
 * (yt-dlp e YouTube finti), immagini salvate in `docs/screenshots/`.
 */
export default defineConfig({
  ...base,
  testDir: './screenshots',
  retries: 0,
  reporter: 'list',
  projects: [
    {
      name: 'screenshots',
      use: {
        ...devices['Pixel 7'],
        deviceScaleFactor: 2,
        colorScheme: 'dark',
        baseURL: 'http://localhost:4173',
      },
    },
  ],
});
