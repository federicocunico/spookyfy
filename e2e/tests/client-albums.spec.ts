import fs from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { ensureServiceWorker, register, uniqueUser } from './helpers';

/** MP3 silenzioso con tag ID3v2.3: titolo, artista, artista dell'album, album, traccia, genere. */
function taggedMp3(tags: Record<'TIT2' | 'TPE1' | 'TPE2' | 'TALB' | 'TRCK' | 'TCON', string>): Buffer {
  const frame = (id: string, value: string) => {
    const data = Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    return Buffer.concat([Buffer.from(id, 'latin1'), size, Buffer.alloc(2), data]);
  };
  const frames = Buffer.concat(Object.entries(tags).map(([id, v]) => frame(id, v)));
  const n = frames.length;
  const header = Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]),
  ]);
  const audioFrame = Buffer.alloc(417);
  audioFrame.set([0xff, 0xfb, 0x90, 0xc0]);
  return Buffer.concat([header, frames, ...Array.from({ length: 115 }, () => audioFrame)]);
}

async function openAlbum(page: Page, title: string) {
  await page.getByRole('link', { name: 'La tua Libreria' }).click();
  await page.getByRole('link', { name: 'Album', exact: true }).click();
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

const rowTitles = (page: Page) => page.getByTestId('track-row').locator('.title').allTextContents();

test('modalità client: album e generi dai tag, copertina da un candidato, backup e ripristino', async ({
  page,
  browser,
  browserName,
}) => {
  await register(page, uniqueUser('clalb', browserName));
  await ensureServiceWorker(page);
  const album = `Disco e2e ${Math.random().toString(36).slice(2, 7)}`;
  const common = { TPE1: 'Band e2e', TPE2: 'Band e2e', TALB: album, TCON: 'Alternative; Indie' };

  // Importati in ordine inverso: l'album segue il numero di traccia.
  await page.getByRole('link', { name: 'La tua Libreria' }).click();
  await page.getByTestId('file-input').setInputFiles([
    {
      name: 'b.mp3',
      mimeType: 'audio/mpeg',
      buffer: taggedMp3({ ...common, TIT2: 'Secondo e2e', TRCK: '2/2' }),
    },
    {
      name: 'a.mp3',
      mimeType: 'audio/mpeg',
      buffer: taggedMp3({ ...common, TIT2: 'Primo e2e', TRCK: '1/2' }),
    },
  ]);
  await expect(page.getByRole('button', { name: /^Riproduci Primo e2e/ }).first()).toBeEnabled({
    timeout: 15_000,
  });

  await openAlbum(page, album);
  await expect.poll(() => rowTitles(page)).toEqual(['Primo e2e', 'Secondo e2e']);
  await expect(page.getByRole('link', { name: 'Alternative' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Indie' })).toBeVisible();

  // La ricerca automatica (gateway → servizi finti) assegna la copertina, servita dal Service Worker.
  const hero = page.locator('.hero .art img');
  await expect(hero).toHaveAttribute('src', /^\/local\/album-cover\//, { timeout: 30_000 });
  const served = await page.evaluate(
    async (url) => {
      const r = await fetch(url);
      return { status: r.status, type: r.headers.get('content-type') };
    },
    (await hero.getAttribute('src'))!,
  );
  expect(served).toEqual({ status: 200, type: 'image/jpeg' });

  // Scelta manuale di un candidato, applicando anche l'anno.
  await page.getByRole('button', { name: 'Copertina dell’album' }).click();
  await page.getByRole('button', { name: 'Cerca online' }).click();
  await page.getByRole('button', { name: new RegExp(`${album} di Band e2e, 1999`) }).click();
  await page.getByLabel(/Anno: 1999/).check();
  await page.getByRole('button', { name: 'Applica' }).click();
  await expect(page.getByText(/Album · Band e2e · 1999/)).toBeVisible();

  // Backup completo e ripristino su un "telefono nuovo": stessi album, ordine, anno e generi.
  await page.goto('/settings');
  await page.evaluate(() => {
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

  const fresh = await browser.newContext({ ...test.info().project.use, serviceWorkers: 'allow' });
  const phone2 = await fresh.newPage();
  await register(phone2, uniqueUser('clalb2', browserName));
  await ensureServiceWorker(phone2);
  await phone2.goto('/settings');
  await phone2.getByTestId('backup-input').setInputFiles(downloads.filter((p) => fs.existsSync(p)));
  await expect(phone2.getByText(/Backup importato: 2 brani aggiunti/)).toBeVisible({ timeout: 15_000 });
  await openAlbum(phone2, album);
  await expect.poll(() => rowTitles(phone2)).toEqual(['Primo e2e', 'Secondo e2e']);
  await expect(phone2.getByText(/Album · Band e2e · 1999/)).toBeVisible();
  await expect(phone2.locator('.hero .art img')).toHaveAttribute('src', /^\/local\/album-cover\//);
  await expect(phone2.getByRole('link', { name: 'Indie' })).toBeVisible();
  await fresh.close();
});
