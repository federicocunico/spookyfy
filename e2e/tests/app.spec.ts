import { type Page, expect, test } from '@playwright/test';
import type { TrackDto } from '@spookyfy/shared';
import { PASSWORD, audioState, ensureServiceWorker, importFromSearch, register, uniqueUser } from './helpers';

const ORIGIN = 'http://localhost:4173';

/**
 * Il WebKit di Playwright per Windows non ha un backend multimediale (non decodifica
 * nemmeno un WAV): lì si verificano solo le risposte del Service Worker. Su Linux
 * (CI) e macOS WebKit decodifica l'audio e i controlli completi restano attivi.
 */
let canDecode = true;
test.beforeEach(({ browserName }) => {
  canDecode = !(browserName === 'webkit' && process.platform === 'win32');
});

/** Importa un video tramite l'API (stessi cookie della pagina) e attende il brano. */
async function ingestViaApi(page: Page, sourceId: string): Promise<TrackDto> {
  const res = await page.request.post('/api/ingest', { data: { sourceId }, headers: { origin: ORIGIN } });
  expect(res.ok()).toBe(true);
  let track: TrackDto | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (await page.request.get('/api/tracks?limit=200')).json()) as {
          items: TrackDto[];
        };
        track = list.items.find((t) => t.sourceId === sourceId);
        return Boolean(track);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return track!;
}

test('percorso completo: registrazione, login, importazione, streaming, download e ascolto offline', async ({
  page,
  context,
  browserName,
}) => {
  const user = uniqueUser('flow', browserName);
  await register(page, user);
  await ensureServiceWorker(page);

  // Logout e nuovo login.
  await page.goto('/settings');
  await page.getByRole('button', { name: /Esci/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Username').fill(user.toUpperCase());
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();

  // Ricerca remota (yt-dlp finto) e importazione: il brano richiesto qui viene anche salvato offline.
  const index = browserName === 'chromium' ? 0 : 1;
  const title = await importFromSearch(page, 'come as you are', index);

  // Streaming immediato.
  await page
    .getByTestId('remote-result')
    .nth(index)
    .getByRole('button', { name: `Riproduci ${title}` })
    .click();
  const mini = page.getByTestId('mini-player');
  await expect(mini).toBeVisible();
  await expect.poll(async () => (await audioState(page)).src).toMatch(/\/api\/tracks\/.+\/audio$/);
  const audioUrl = (await audioState(page)).src!;
  // Il file è stato davvero scaricato e decodificato (metadati e durata del brano di 3 s).
  if (canDecode) {
    await expect.poll(async () => (await audioState(page)).readyState).toBeGreaterThanOrEqual(1);
    expect((await audioState(page)).duration).toBeCloseTo(3, 0);
  }

  // Player a schermo intero con swipe verso l'alto sul mini-player.
  const box = (await mini.boundingBox())!;
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 3, box.y - 60, { steps: 6 });
  await page.mouse.up();
  const full = page.getByTestId('full-player');
  await expect(full).toBeVisible();
  await expect(full.locator('[data-status]')).toHaveAttribute('data-status', 'downloaded', {
    timeout: 20_000,
  });

  // La barra di avanzamento è facile da toccare (≥ 44 px).
  expect((await full.getByRole('slider').boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Indietro chiude il player senza cambiare vista.
  await page.goBack();
  await expect(full).toBeHidden();
  await expect(page).toHaveURL(/\/search$/);

  // Il Service Worker serve il brano scaricato con risposte parziali (206).
  const range = await page.evaluate(async (url) => {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1' } });
    return {
      status: r.status,
      length: (await r.arrayBuffer()).byteLength,
      range: r.headers.get('content-range'),
    };
  }, audioUrl);
  expect(range.status).toBe(206);
  expect(range.length).toBe(2);
  expect(range.range).toMatch(/^bytes 0-1\/\d+$/);

  // Offline: l'app si avvia dalla cache e il brano scaricato si riproduce, con seek.
  await context.setOffline(true);
  await page.goto('/library/downloaded');
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  const offlineRange = await page.evaluate(async (url) => {
    const r = await fetch(url, { headers: { Range: 'bytes=100-199' } });
    return { status: r.status, length: (await r.arrayBuffer()).byteLength };
  }, audioUrl);
  expect(offlineRange).toEqual({ status: 206, length: 100 });

  const row = page.getByTestId('track-row').first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^Riproduci / }).click();
  await expect.poll(async () => (await audioState(page)).src).toBe(audioUrl);
  if (canDecode) {
    // Decodificato dalla copia in cache servita dal Service Worker (siamo offline), con seek.
    await expect.poll(async () => (await audioState(page)).readyState).toBeGreaterThanOrEqual(1);
    expect((await audioState(page)).duration).toBeCloseTo(3, 0);
    await page.evaluate(() => {
      const a = document.querySelector('audio')!;
      a.currentTime = 2;
    });
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThanOrEqual(1.9);
    expect((await audioState(page)).error).toBeNull();
  }
  await context.setOffline(false);
});

test('offline: una playlist parzialmente scaricata è consultabile e i brani mancanti sono attenuati', async ({
  page,
  context,
  browserName,
}) => {
  await register(page, uniqueUser('pl', browserName));
  await ensureServiceWorker(page);
  const b = browserName === 'chromium' ? 'c' : 'w';
  const a = await ingestViaApi(page, `pl${b}A0000000`);
  const missing = await ingestViaApi(page, `pl${b}B0000000`);
  const created = await page.request.post('/api/playlists', {
    data: { name: 'Viaggio' },
    headers: { origin: ORIGIN },
  });
  const playlist = (await created.json()) as { id: string };
  for (const t of [a, missing]) {
    await page.request.post(`/api/playlists/${playlist.id}/items`, {
      data: { trackId: t.id },
      headers: { origin: ORIGIN },
    });
  }

  // Online: si apre la playlist (snapshot salvato) e si scarica solo il primo brano.
  await page.goto(`/playlist/${playlist.id}`);
  await expect(page.getByRole('heading', { name: 'Viaggio' })).toBeVisible();
  await page.getByRole('button', { name: `Altre azioni per ${a.title}` }).click();
  await page.locator('[data-action="download"]').click();
  await expect(page.getByTestId('track-row').first().getByLabel('Scaricato')).toBeVisible({
    timeout: 15_000,
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Viaggio' })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`^Riproduci ${a.title} di`) })).toBeEnabled();
  await expect(
    page.getByRole('button', { name: new RegExp(`^Riproduci ${missing.title} di`) }),
  ).toBeDisabled();
  await context.setOffline(false);
});

test('PWA installabile (criteri di Chrome) con manifest completo', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Verifica tramite DevTools Protocol di Chromium');
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);

  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({
    name: 'Spookyfy',
    display: 'standalone',
    background_color: '#0b0a10',
    theme_color: '#0b0a10',
  });
  expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toContain('maskable');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/icons/apple-touch-icon.png',
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
});

test('nessuno spostamento di layout (CLS = 0) sulle viste principali', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Layout Instability API disponibile solo in Chromium');
  await register(page, uniqueUser('cls', browserName));
  await ingestViaApi(page, 'clsTrack001');
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) w.__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  for (const path of ['/', '/library', '/search', '/favorites', '/settings']) {
    await page.goto(path);
    // Il canale WebSocket resta aperto: niente "networkidle", si attende la fine del rendering.
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, `CLS su ${path}`).toBe(0);
  }
});

test('la tab bar rispetta l’area sicura dell’iPhone (indicatore Home)', async ({ page, browserName }) => {
  await register(page, uniqueUser('safe', browserName));
  // I browser desktop non emulano env(safe-area-inset-bottom): si imposta l'inset di un iPhone (34 px).
  await page.addStyleTag({ content: ':root { --safe-bottom: 34px !important; }' });
  const viewport = page.viewportSize()!;
  for (const name of ['Home', 'Cerca', 'La tua Libreria']) {
    const tab = page.getByRole('link', { name });
    const box = (await tab.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 34);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('link', { name: 'Cerca' }).click();
  await expect(page.getByRole('link', { name: 'Cerca' })).toHaveAttribute('aria-current', 'page');
  const color = await page.getByRole('link', { name: 'Cerca' }).evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe('rgb(245, 243, 250)');
  const blur = await page
    .getByRole('navigation', { name: 'Navigazione principale' })
    .evaluate(
      (el) =>
        getComputedStyle(el).backdropFilter ||
        getComputedStyle(el).getPropertyValue('-webkit-backdrop-filter'),
    );
  expect(blur).toContain('blur(10px)');
});

test('su PC la navigazione è una colonna a sinistra e il contenuto non ci finisce sotto', async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await register(page, uniqueUser('desk', browserName));
  const nav = (await page.getByRole('navigation', { name: 'Navigazione principale' }).boundingBox())!;
  expect(nav.x).toBeLessThan(16);
  expect(nav.height).toBeGreaterThan(400);
  const title = (await page.getByRole('heading', { level: 1 }).first().boundingBox())!;
  expect(title.x).toBeGreaterThanOrEqual(nav.x + nav.width);
  for (const name of ['Home', 'Cerca', 'La tua Libreria']) {
    const tab = (await page.getByRole('link', { name }).boundingBox())!;
    expect(tab.x + tab.width).toBeLessThanOrEqual(nav.x + nav.width);
    expect(tab.height).toBeGreaterThanOrEqual(44);
  }
});
