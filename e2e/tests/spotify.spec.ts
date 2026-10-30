import { type Page, expect, test } from '@playwright/test';
import { PASSWORD, audioState, ensureServiceWorker, register, uniqueUser } from './helpers';

const TRACK = '0000000000000000000001';

async function connect(page: Page, browser: string) {
  const username = uniqueUser('sp', browser);
  await register(page, username);
  await page.goto('/settings');
  const settings = page.getByRole('region', { name: 'Collegamento Spotify' });
  await settings.getByRole('checkbox').check();
  await settings.getByRole('button', { name: 'Collega Spotify', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\?spotify=linked/);
  await expect(settings.getByText('Premium verificato', { exact: true })).toBeVisible();
  return username;
}

async function authorize(page: Page, label: string) {
  await page.goto('/settings');
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(page).toHaveURL(/\/settings\?spotify=linked/);
  if (label === 'Autorizza riproduzione Spotify') {
    await expect(page.getByText('Riproduzione Spotify autorizzata.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }
}

async function searchSpotify(page: Page) {
  await page.getByRole('link', { name: 'Cerca', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Ricerca Spotify', exact: true }).fill('Midnight');
  await page.getByRole('button', { name: 'Cerca su Spotify', exact: true }).click();
  const region = page.getByRole('region', { name: 'Ricerca Spotify' });
  await region.getByRole('button', { name: 'Midnight demo Demo artist', exact: true }).click();
  await expect(region.getByRole('heading', { name: 'Midnight demo', exact: true })).toBeVisible();
  return region;
}

async function importLocalSong(page: Page, query: string) {
  await page.getByRole('link', { name: 'Cerca', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Cerca brani o artisti', exact: true });
  await search.fill(query);
  await search.press('Enter');
  const row = page.getByTestId('remote-result').first();
  const title = (await row.locator('.title').textContent())!.trim();
  const add = row.getByRole('button', { name: /Aggiungi/ });
  if (await add.isVisible()) await add.click();
  await expect(row.getByRole('button', { name: `Riproduci ${title}` })).toBeVisible({ timeout: 20000 });
  // The ingest fixture supplies canonical tags which can differ from the search title.
  await page.getByRole('link', { name: 'La tua Libreria', exact: true }).click();
  const imported = page.getByTestId('track-row').first();
  await expect(imported).toBeVisible();
  return (await imported.locator('.title').textContent())!.trim();
}

/** SDK protocol double: no Spotify network or audio, while backend commands remain real. */
async function installSdk(page: Page) {
  // Install before each document: WebKit service-worker requests bypass page.route.
  await page.addInitScript(`
      window.Spotify = { Player: class {
        constructor(options) { this.options=options; this.listeners={}; this.state={paused:true,position:0,duration:180000,disallows:{},track_window:{current_track:{uri:'spotify:track:${TRACK}',name:'Midnight demo',artists:[{name:'Demo artist'}],album:{name:'Demo album',images:[]}}}}; }
        addListener(name,fn) { this.listeners[name]=fn; return true; }
        removeListener(name) { delete this.listeners[name]; return true; }
        async connect() { this.options.getOAuthToken(()=>{}); queueMicrotask(()=>this.listeners.ready?.({device_id:'fake-browser'})); return true; }
        disconnect() { this.listeners={}; }
        async activateElement() {}
        async getCurrentState() { return this.state; }
        async pause() { this.state.paused=true; await fetch('/api/spotify/playback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'pause',deviceId:'fake-browser'})}); }
      }};
      window.onSpotifyWebPlaybackSDKReady?.();
    `);
}

test('Spotify: linking dopo registrazione, ricerca, playlist native e scollegamento', async ({
  page,
  browserName,
}, testInfo) => {
  const anonymous = await page.request.get('/api/spotify/status');
  expect(anonymous.status()).toBe(401);
  await connect(page, browserName);
  await authorize(page, 'Autorizza modifiche playlist Spotify');
  await page.goto('/spotify');
  await page.getByRole('button', { name: 'Carica libreria Spotify', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Demo playlist', exact: true })).toBeVisible();
  await expect(page.getByLabel('Contenuto da Spotify').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath('spotify-library.png'), fullPage: true });
  await page.getByText('Crea playlist Spotify', { exact: true }).click();
  const name = `Prova ${browserName}`;
  await page.getByRole('textbox', { name: 'Nome nuova playlist Spotify' }).fill(name);
  await page.getByRole('button', { name: 'Crea playlist', exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name, exact: true }).click();
  const native = page.getByRole('region', { name: 'Libreria Spotify' });
  await native
    .getByLabel('Cerca brani da aggiungere alla playlist Spotify', { exact: true })
    .fill('Midnight');
  await native.getByRole('button', { name: 'Cerca brani per la playlist', exact: true }).click();
  const addNative = native.getByRole('button', {
    name: 'Aggiungi Midnight demo alla playlist Spotify',
    exact: true,
  });
  await addNative.click();
  const removeNative = native.getByRole('button', {
    name: 'Rimuovi tutte le occorrenze di questo brano',
    exact: true,
  });
  await expect(removeNative).toHaveCount(1);
  await addNative.click();
  await expect(removeNative).toHaveCount(2);
  await native.getByRole('button', { name: 'Sposta su', exact: true }).nth(1).click();
  await expect(removeNative).toHaveCount(2);
  await removeNative.first().click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Rimuovi tutte le occorrenze', exact: true })
    .click();
  await expect(removeNative).toHaveCount(0);
  const region = await searchSpotify(page);
  await expect(region.getByRole('link', { name: 'Apri su Spotify', exact: true })).toHaveAttribute(
    'href',
    `https://open.spotify.com/track/${TRACK}`,
  );
  await expect(region.getByRole('button', { name: /Scarica|tag|YouTube/ })).toHaveCount(0);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Scollega Spotify', exact: true }).click();
  await expect(page.getByText('Spotify non collegato', { exact: true })).toBeVisible();
  await page.goto('/library');
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();
});

test('Spotify: player ufficiale simulato e ritorno ai file locali senza doppio audio', async ({
  page,
  browserName,
}) => {
  await installSdk(page);
  await connect(page, browserName);
  await authorize(page, 'Autorizza riproduzione Spotify');
  const localTitle = await importLocalSong(page, 'handoff e2e');
  const player = page.getByRole('region', { name: 'Player Spotify' });
  await player.getByText('Dispositivi e player Spotify', { exact: true }).click();
  await player.getByRole('button', { name: 'Attiva player browser Spotify', exact: true }).click();
  await player.getByRole('button', { name: 'Usa questo browser', exact: true }).click();
  const region = await searchSpotify(page);
  await region.getByRole('button', { name: 'Riproduci su Spotify', exact: true }).click();
  await expect(player.getByRole('button', { name: 'Pausa Spotify', exact: true })).toBeVisible();
  expect((await audioState(page)).paused).toBe(true);
  expect((await audioState(page)).src).toBeNull();
  await player.getByRole('button', { name: 'Pausa Spotify', exact: true }).click();
  await expect(player.getByRole('button', { name: 'Riprendi Spotify', exact: true })).toBeVisible();
  await player.getByRole('button', { name: 'Riprendi Spotify', exact: true }).click();
  await expect(player.getByRole('button', { name: 'Pausa Spotify', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'La tua Libreria', exact: true }).click();
  await page
    .getByRole('button', { name: new RegExp(`^Riproduci ${localTitle}`) })
    .first()
    .click();
  await expect.poll(async () => (await audioState(page)).src).toMatch(/^\/(api\/tracks|local\/audio)\//);
  await expect(page.locator('.spotify-player.active')).toHaveCount(0);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Scollega Spotify', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Player Spotify' })).toHaveCount(0);
});

test('Spotify: raccolta ibrida conserva ordine e file locali dopo unlink', async ({
  page,
  browser,
  browserName,
}, info) => {
  const username = await connect(page, browserName);
  const isClient = info.project.name.startsWith('client-');
  // Existing import path remains independent from Spotify.
  const title = await importLocalSong(page, 'hybrid e2e');
  await page.goto('/collections');
  await page.getByRole('textbox', { name: 'Nome raccolta', exact: true }).fill('Notte ibrida');
  await page.getByRole('button', { name: 'Crea raccolta', exact: true }).click();
  const localSelect = page.getByRole('combobox', { name: 'Brano locale', exact: true });
  const localValue = () =>
    localSelect
      .locator('option')
      .evaluateAll(
        (options, title) =>
          (options as HTMLOptionElement[]).find((option) => option.label.includes(title))?.value,
        title,
      );
  await expect.poll(localValue).toBeTruthy();
  await localSelect.selectOption((await localValue())!);
  await page.getByRole('button', { name: 'Aggiungi occorrenza', exact: true }).click();
  await expect(page.getByRole('article').locator('li')).toHaveCount(1);
  const region = await searchSpotify(page);
  await region.getByRole('button', { name: 'Scegli raccolta Spookyfy', exact: true }).click();
  await region
    .getByLabel('Raccolta Spookyfy di destinazione', { exact: true })
    .selectOption({ label: 'Notte ibrida' });
  await region.getByRole('button', { name: 'Aggiungi riferimento alla raccolta', exact: true }).click();
  await expect(page.getByText('Riferimento Spotify aggiunto alla raccolta', { exact: true })).toBeVisible();
  await page.goto('/collections');
  const collection = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Notte ibrida' }) });
  await expect(collection.locator('li')).toHaveCount(2);
  if (isClient) {
    await ensureServiceWorker(page);
    await page.context().setOffline(true);
    await page.reload();
    await expect(collection.locator('li')).toHaveCount(2);
    await page.context().setOffline(false);

    // Portable hybrid backup is tested in a fresh browser database, with the same local account.
    await page.goto('/settings');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    });
    const files: string[] = [];
    page.on('download', async (download) => {
      const path = info.outputPath(download.suggestedFilename());
      await download.saveAs(path);
      files.push(path);
    });
    await page.getByRole('button', { name: /Esporta con audio/ }).click();
    await expect.poll(() => files.length).toBe(2);
    const fresh = await browser.newContext({ ...info.project.use, serviceWorkers: 'allow' });
    try {
      const phone = await fresh.newPage();
      await phone.goto('/login');
      await phone.getByLabel('Username').fill(username);
      await phone.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await phone.getByRole('button', { name: 'Accedi', exact: true }).click();
      await expect(phone).toHaveURL(/\/$/);
      await phone.goto('/settings');
      await phone.getByTestId('backup-input').setInputFiles(files);
      await expect(phone.getByText(/Backup importato:/)).toBeVisible();
      await phone.goto('/collections');
      await expect(phone.getByRole('article').locator('li')).toHaveCount(2);
      await expect(
        phone.getByText('Da riconciliare con lo stesso account Spotify', { exact: true }),
      ).toBeVisible();
    } finally {
      await fresh.close();
    }
  }
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Scollega Spotify', exact: true }).click();
  await expect(page.getByText('Spotify non collegato', { exact: true })).toBeVisible();
  await page.goto('/collections');
  await expect(collection.locator('li')).toHaveCount(1);
  await expect(collection).toContainText(title);
  await page.goto('/library');
  const localPlay = page
    .getByTestId('track-row')
    .filter({ hasText: title })
    .first()
    .getByRole('button', { name: /^Riproduci / });
  await expect(localPlay).toBeEnabled();
  await page.reload();
  await expect(localPlay).toBeEnabled();
  expect(
    await page.evaluate(async () => {
      const databases = await indexedDB.databases();
      return databases.some((db) => db.version === 4);
    }),
  ).toBe(true);
  await localPlay.click();
  await expect.poll(async () => (await audioState(page)).src).toMatch(/^\/(api\/tracks|local\/audio)\//);
});

test.describe('errori provider e rollback dei flag', () => {
  // Playwright cannot intercept requests initiated by the service worker itself.
  test.use({ serviceWorkers: 'block' });
  test('Spotify: requisito Premium non verificabile e guasto provider non fanno uscire da Spookyfy', async ({
    page,
    browserName,
  }) => {
    await connect(page, browserName);
    await page.route('**/api/spotify/status', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, entitlement: 'unknown' } });
    });
    await page.goto('/settings');
    await expect(
      page.getByText('Spotify richiede Premium; abbonamento non verificabile.', { exact: true }),
    ).toBeVisible();
    let failure = { status: 409, code: 'SPOTIFY_REAUTH_REQUIRED', message: 'Ricollega Spotify' };
    await page.route('**/api/spotify/search?**', (route) =>
      route.fulfill({
        status: failure.status,
        json: { error: { code: failure.code, message: failure.message } },
      }),
    );
    await page.goto('/search');
    for (const scenario of [
      failure,
      { status: 403, code: 'SPOTIFY_ACCESS_RESTRICTED', message: 'Accesso Spotify limitato' },
      { status: 429, code: 'SPOTIFY_RATE_LIMITED', message: 'Attendi il limite Spotify' },
      { status: 429, code: 'SPOTIFY_QUOTA_EXCEEDED', message: 'Quota Spotify esaurita' },
      { status: 502, code: 'SPOTIFY_UNAVAILABLE', message: 'Spotify temporaneamente indisponibile' },
    ]) {
      failure = scenario;
      await page.getByRole('searchbox', { name: 'Ricerca Spotify', exact: true }).fill(scenario.code);
      await page.getByRole('button', { name: 'Cerca su Spotify', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Ricerca Spotify' })).toContainText(scenario.message);
      await expect(page.getByRole('searchbox', { name: 'Cerca brani o artisti', exact: true })).toBeEnabled();
    }
    const title = await importLocalSong(page, 'modulo isolato');
    await page.route('**/api/spotify/status', async (route) => {
      const response = await route.fetch();
      const status = await response.json();
      await route.fulfill({
        response,
        json: {
          ...status,
          mode: 'disabled',
          capabilities: {
            ...status.capabilities,
            canBrowse: false,
            canStream: false,
            canHybridPlayback: false,
          },
          reason: 'SPOTIFY_NOT_CONFIGURED',
        },
      });
    });
    // Revalidate flags on foreground return; keep this SW-blocked test in the same document.
    // Full offline reload/persistence is covered with the real service worker above.
    await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText('Spotify disattivato.', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'La tua Libreria', exact: true }).click();
    await page
      .getByTestId('track-row')
      .filter({ hasText: title })
      .first()
      .getByRole('button', { name: /^Riproduci / })
      .click();
    await expect
      .poll(async () => (await audioState(page)).src)
      .toMatch(/^(\/(api\/tracks|local\/audio)\/|blob:)/);
  });
});
