import { type Page, expect } from '@playwright/test';

export const TOKEN = 'spotifymerdacostosa2026';
export const PASSWORD = 'Notte#2026';

let counter = 0;
/** Username unico per test e browser (il database è condiviso dall'esecuzione). */
export function uniqueUser(prefix: string, browser: string): string {
  return `${prefix}-${browser}-${Date.now().toString(36)}${counter++}`.slice(0, 32);
}

export async function register(page: Page, username: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Conferma password').fill(PASSWORD);
  await page.getByLabel('Token di invito').fill(TOKEN);
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();
}

/** Attende che il Service Worker controlli la pagina (al primo caricamento serve un reload). */
export async function ensureServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  }
}

/** Cerca su "YouTube" (yt-dlp finto) e importa il risultato n; attende che sia in libreria. */
export async function importFromSearch(page: Page, query: string, index = 0): Promise<string> {
  await page.getByRole('link', { name: 'Cerca' }).click();
  const box = page.getByRole('searchbox');
  await box.fill(query);
  await box.press('Enter');
  const row = page.getByTestId('remote-result').nth(index);
  await expect(row).toBeVisible();
  const title = (await row.locator('.title').textContent())!.trim();
  const add = row.getByRole('button', { name: /Aggiungi/ });
  if (await add.isVisible()) await add.click();
  await expect(row.getByRole('button', { name: `Riproduci ${title}` })).toBeVisible({ timeout: 20_000 });
  return title;
}

/** Stato del download mostrato dal toggle (`none`, `downloading`, `downloaded`…). */
export function downloadStatus(page: Page) {
  return page.getByTestId('full-player').locator('[data-status]').getAttribute('data-status');
}

export async function audioState(page: Page) {
  return page.evaluate(() => {
    const a = document.querySelector('audio')!;
    return {
      src: a.getAttribute('src'),
      paused: a.paused,
      time: a.currentTime,
      error: a.error?.code ?? null,
      readyState: a.readyState,
      duration: a.duration,
    };
  });
}
