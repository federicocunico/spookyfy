import path from 'node:path';
import { type Page, devices, expect, test } from '@playwright/test';
import { CLIENT_URL } from '../playwright.config';
import { ensureServiceWorker, importFromSearch, register, uniqueUser } from '../tests/helpers';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');

async function shot(page: Page, name: string) {
  // Lascia terminare transizioni e caricamento delle copertine; nasconde le notifiche temporanee.
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({ content: '.toasts { display: none !important; }' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test('on-premise', async ({ page }) => {
  await page.goto('/register');
  await shot(page, 'register');

  await register(page, uniqueUser('demo', 'shots'));
  await ensureServiceWorker(page);
  for (const i of [0, 1, 2]) await importFromSearch(page, 'come as you are', i);
  await shot(page, 'search');

  await page
    .getByTestId('remote-result')
    .first()
    .getByRole('button', { name: /^Riproduci/ })
    .click();
  const mini = page.getByTestId('mini-player');
  await expect(mini).toBeVisible();
  await page.getByRole('link', { name: 'Home' }).click();
  await shot(page, 'home');

  await page.getByRole('link', { name: 'La tua Libreria' }).click();
  await shot(page, 'library');

  const box = (await mini.boundingBox())!;
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 3, box.y - 60, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('full-player')).toBeVisible();
  await page.evaluate(() => document.querySelector('audio')?.pause());
  await shot(page, 'player');
});

test.describe('PC', () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    userAgent: devices['Desktop Chrome'].userAgent,
  });

  test('home con colonna di navigazione e barra del player', async ({ page }) => {
    await register(page, uniqueUser('demo', 'desktop'));
    await ensureServiceWorker(page);
    for (const i of [0, 1, 2]) await importFromSearch(page, 'come as you are', i);
    await page
      .getByTestId('remote-result')
      .first()
      .getByRole('button', { name: /^Riproduci/ })
      .click();
    await expect(page.getByTestId('mini-player')).toBeVisible();
    await page.evaluate(() => document.querySelector('audio')?.pause());
    await page.getByRole('link', { name: 'Home' }).click();
    await shot(page, 'desktop');
  });
});

test.describe('modalità client', () => {
  test.use({ baseURL: CLIENT_URL });

  test('libreria e impostazioni', async ({ page }) => {
    await register(page, uniqueUser('demo', 'client'));
    await ensureServiceWorker(page);
    await importFromSearch(page, 'come as you are', 0);
    await page.getByRole('link', { name: 'La tua Libreria' }).click();
    await expect(page.getByRole('button', { name: 'Importa da file' })).toBeVisible();
    await shot(page, 'client-library');

    await page.goto('/settings');
    await expect(page.getByTestId('device-count')).toBeVisible();
    await shot(page, 'client-settings');
  });
});
