import fs from 'node:fs';
import path from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { PASSWORD, TOKEN, audioState, ensureServiceWorker, register, uniqueUser } from './helpers';

// Host diverso dal gateway (localhost:4174): i cookie non distinguono le porte, e in
// produzione i due servizi stanno comunque su domini diversi.
const ONPREM = 'http://127.0.0.1:4173';
/** Origine pubblica configurata sul server on-premise (controllo CSRF delle sue rotte con cookie). */
const ONPREM_ORIGIN = 'http://localhost:4173';

/** Il WebKit di Playwright per Windows non decodifica audio (vedi app.spec.ts). */
let canDecode = true;
test.beforeEach(({ browserName }) => {
  canDecode = !(browserName === 'webkit' && process.platform === 'win32');
});

async function search(page: Page, q: string) {
  await page.getByRole('link', { name: 'Cerca' }).click();
  const box = page.getByRole('searchbox');
  await box.fill(q);
  await box.press('Enter');
}

/** Account e token sul server on-premise (ponte), via API con l'origine dell'on-premise. */
async function bridgeToken(page: Page, username: string): Promise<string> {
  const ctx = page.context().request;
  const headers = { origin: ONPREM_ORIGIN };
  await ctx.post(`${ONPREM}/api/auth/register`, {
    data: { username, password: PASSWORD, token: TOKEN },
    headers,
  });
  const res = await ctx.post(`${ONPREM}/api/me/tokens`, { data: { name: 'client e2e' }, headers });
  expect(res.status()).toBe(201);
  return (await res.json()).token as string;
}

test('modalità client: importazione sul dispositivo, ascolto immediato, offline, backup e ripristino', async ({
  page,
  context,
  browser,
  browserName,
}) => {
  await register(page, uniqueUser('cl', browserName));
  await ensureServiceWorker(page);
  // L'app ha rilevato la modalità client: niente filtro "Scaricati", c'è "Importa da file".
  await page.getByRole('link', { name: 'La tua Libreria' }).click();
  await expect(page.getByRole('button', { name: 'Importa da file' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Scaricati/ })).toHaveCount(0);

  // Ricerca sul gateway e importazione con ascolto immediato in streaming.
  await search(page, 'come as you are');
  const row = page.getByTestId('remote-result').first();
  await expect(row).toBeVisible();
  const title = (await row.locator('.title').textContent())!.trim();
  await row.getByRole('button', { name: /Aggiungi/ }).click();
  await expect(row.getByRole('button', { name: `Riproduci ${title}` })).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: `Riproduci ${title}` }).click();
  await expect.poll(async () => (await audioState(page)).src).toMatch(/^\/local\/audio\//);
  const localUrl = (await audioState(page)).src!;
  if (canDecode) {
    await expect.poll(async () => (await audioState(page)).readyState).toBeGreaterThanOrEqual(1);
    expect((await audioState(page)).duration).toBeCloseTo(3, 0);
  }

  // Il Service Worker serve la copia locale con risposte 206, anche offline.
  await context.setOffline(true);
  const range = await page.evaluate(async (url) => {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1' } });
    return { status: r.status, length: (await r.arrayBuffer()).byteLength };
  }, localUrl);
  expect(range).toEqual({ status: 206, length: 2 });

  // Avvio offline: libreria del dispositivo consultabile e riproducibile.
  await page.goto('/library');
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  const track = page.getByRole('button', { name: /^Riproduci Canzone / }).first();
  await expect(track).toBeEnabled();
  await track.click();
  await expect.poll(async () => (await audioState(page)).src).toBe(localUrl);
  if (canDecode) {
    await expect.poll(async () => (await audioState(page)).readyState).toBeGreaterThanOrEqual(1);
    await page.evaluate(() => {
      document.querySelector('audio')!.currentTime = 2;
    });
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThanOrEqual(1.9);
  }
  await context.setOffline(false);

  // Backup completo (metadati + parte audio) e ripristino su un "telefono nuovo".
  await page.goto('/settings');
  await page.evaluate(() => {
    // Desktop: niente foglio di condivisione, si usa il download.
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  const downloads: string[] = [];
  page.on('download', async (d) => {
    const p = test.info().outputPath(d.suggestedFilename());
    await d.saveAs(p);
    downloads.push(p);
  });
  await page.getByRole('button', { name: /Esporta con audio/ }).click();
  await expect.poll(() => downloads.length, { timeout: 15_000 }).toBe(2);
  await expect(page.getByTestId('last-backup')).toContainText('Ultimo backup');

  const fresh = await browser.newContext({ ...test.info().project.use, serviceWorkers: 'allow' });
  const phone2 = await fresh.newPage();
  await register(phone2, uniqueUser('cl2', browserName));
  await phone2.goto('/settings');
  await phone2.getByTestId('backup-input').setInputFiles(downloads.filter((p) => fs.existsSync(p)));
  await expect(phone2.getByText(/Backup importato: 1 brano aggiunto/)).toBeVisible({ timeout: 15_000 });
  await phone2.goto('/library');
  await expect(phone2.getByRole('button', { name: /^Riproduci Canzone / }).first()).toBeEnabled();
  await fresh.close();
});

test('modalità client: con YouTube bloccato si cerca e si importa tramite il server di casa', async ({
  page,
  browserName,
}) => {
  const user = uniqueUser('br', browserName);
  const token = await bridgeToken(page, user);
  await register(page, user);

  // Configurazione del ponte con verifica della connessione.
  await page.goto('/settings');
  await page.getByLabel('Indirizzo del server').fill(ONPREM);
  await page.getByLabel('Token di accesso').fill(token);
  await page.getByRole('button', { name: 'Verifica e salva' }).click();
  await expect(page.getByTestId('bridge-status')).toContainText('Ponte attivo');

  // Il gateway finto blocca le query che contengono "blocked".
  await search(page, 'blocked song');
  await expect(page.getByTestId('search-alternatives')).toBeVisible();
  await page.getByRole('button', { name: 'Cerca tramite il server di casa' }).click();
  const index = browserName === 'webkit' ? 3 : 2;
  const row = page.getByTestId('remote-result').nth(index);
  await expect(row).toBeVisible();
  const title = (await row.locator('.title').textContent())!.trim();
  await row.getByRole('button', { name: /Aggiungi/ }).click();
  await expect(row.getByRole('button', { name: `Riproduci ${title}` })).toBeVisible({ timeout: 30_000 });

  // Il brano è sul dispositivo, copiato dal server di casa.
  await page.goto('/library');
  await expect(page.getByRole('button', { name: /^Riproduci Canzone srch/ }).first()).toBeEnabled();
});

test('modalità client: token del ponte errato rifiutato con un messaggio', async ({ page, browserName }) => {
  await register(page, uniqueUser('bx', browserName));
  await page.goto('/settings');
  await page.getByLabel('Indirizzo del server').fill(ONPREM);
  await page.getByLabel('Token di accesso').fill('spk_sbagliato');
  await page.getByRole('button', { name: 'Verifica e salva' }).click();
  await expect(page.getByTestId('bridge-status')).toContainText(/Token|non valido|revocato/);
});

/** MP3 valido e silenzioso (come apps/server/test/fixtures/media.ts). */
function silentMp3(seconds: number): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc0]);
  return Buffer.concat(Array.from({ length: Math.ceil((seconds * 44100) / 1152) }, () => frame));
}

async function importAndPlay(page: Page, name: string) {
  await page.getByRole('link', { name: 'La tua Libreria' }).click();
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: `${name}.mp3`, mimeType: 'audio/mpeg', buffer: silentMp3(3) });
  const play = page.getByRole('button', { name: new RegExp(`^Riproduci ${name}`) }).first();
  await expect(play).toBeEnabled({ timeout: 15_000 });
  await play.click();
  await expect.poll(async () => (await audioState(page)).src).toBeTruthy();
  if (canDecode) {
    await expect.poll(async () => (await audioState(page)).readyState).toBeGreaterThanOrEqual(1);
    expect((await audioState(page)).error).toBeNull();
  }
  await expect(page.getByText('non è disponibile offline')).toHaveCount(0);
}

test('modalità client: file importato riproducibile alla prima visita, senza ricaricare', async ({
  page,
  browserName,
}) => {
  await register(page, uniqueUser('clfirst', browserName));
  await importAndPlay(page, 'Prima visita');
});

test.describe('senza Service Worker (ricarica forzata con Ctrl+F5)', () => {
  test.use({ serviceWorkers: 'block' });

  test('modalità client: file importato comunque riproducibile', async ({ page, browserName }) => {
    await register(page, uniqueUser('clnosw', browserName));
    await importAndPlay(page, 'Senza service worker');
  });
});

test('modalità client: auto-trim, si saltano i silenzi lunghi a inizio e fine brano', async ({
  page,
  browserName,
}) => {
  test.skip(!canDecode, 'Il WebKit di Playwright per Windows non decodifica audio');
  await register(page, uniqueUser('cltrim', browserName));
  await page.getByRole('link', { name: 'La tua Libreria' }).click();
  // 7 s di silenzio, 2 s di tono a 440 Hz, 7 s di silenzio (generato con ffmpeg).
  await page
    .getByTestId('file-input')
    .setInputFiles(path.join(import.meta.dirname, '../fixtures/silence-edges.mp3'));
  const play = page.getByRole('button', { name: /^Riproduci Silenzio ai bordi/ }).first();
  await expect(play).toBeEnabled({ timeout: 15_000 });
  await play.click();

  // Parte poco prima del tono, non da 0:00.
  await expect.poll(async () => (await audioState(page)).time).toBeGreaterThanOrEqual(6.5);
  expect((await audioState(page)).time).toBeLessThan(8.5);
  // A fine tono si ferma (ultimo brano della coda) invece di suonare 7 s di silenzio.
  await expect.poll(async () => (await audioState(page)).paused, { timeout: 10_000 }).toBe(true);
  expect((await audioState(page)).time).toBeGreaterThan(8.9);
  expect((await audioState(page)).time).toBeLessThan(10.5);
});
