import { type Page, expect, test } from '@playwright/test';
import type { AlbumDto, TrackDto } from '@spookyfy/shared';
import { audioState, register, uniqueUser } from './helpers';

const ORIGIN = 'http://localhost:4173';
const rand = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');

/** Importa un video dello yt-dlp finto (gli id "topic…" hanno album "Nevermind" di "Nirvana"). */
async function ingest(page: Page, sourceId: string): Promise<TrackDto> {
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

const albumOf = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/albums/${id}`)).json()) as AlbumDto;

test('on-premise: album automatico con copertina trovata online, riordino, genere e ascolto per genere', async ({
  page,
  browserName,
}) => {
  await register(page, uniqueUser('alb', browserName));
  const a = await ingest(page, `topic${rand()}`);
  const b = await ingest(page, `topic${rand()}`);
  expect(a.albumId).toBeTruthy();
  expect(b.albumId).toBe(a.albumId);
  const albumId = a.albumId!;

  // La ricerca automatica (servizi musicali finti) assegna la copertina, mostrata anche dai brani.
  await expect
    .poll(async () => (await albumOf(page, albumId)).hasCustomCover, { timeout: 20_000 })
    .toBe(true);

  await page.getByRole('link', { name: 'La tua Libreria' }).click();
  await page.getByRole('link', { name: 'Album', exact: true }).click();
  await expect(page).toHaveURL(/\/library\/albums$/);
  await page
    .getByRole('link', { name: /Nevermind/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/album/${albumId}$`));
  await expect(page.getByRole('heading', { name: 'Nevermind' })).toBeVisible();
  const heroCover = page.locator('.hero .art img');
  await expect(heroCover).toHaveAttribute('src', /\/api\/albums\/.+\/cover\?size=512&v=\d+/);

  // Riproduzione dal primo brano: player con la copertina dell'album.
  await page.getByRole('button', { name: 'Riproduci Nevermind' }).click();
  await expect.poll(async () => (await audioState(page)).src).toMatch(/^\/api\/tracks\/.+\/audio$/);
  await expect(page.getByTestId('mini-player').locator('img').first()).toHaveAttribute(
    'src',
    /\/api\/albums\/.+\/cover\?size=/,
  );

  // Riordino con la tastiera, salvato sul server.
  const before = (await albumOf(page, albumId)).tracks.map((t) => t.id);
  const handles = page.getByRole('button', { name: /^Sposta / });
  await handles.last().focus();
  await handles.last().press('ArrowUp');
  const expected = [...before];
  const last = expected.pop()!;
  expected.splice(expected.length - 1, 0, last);
  await expect.poll(async () => (await albumOf(page, albumId)).tracks.map((t) => t.id)).toEqual(expected);

  // Genere su tutto l'album e ascolto per genere.
  const genre = `Grunge ${rand()}`;
  await page.getByRole('button', { name: 'Modifica album' }).click();
  await page.getByLabel('Generi di tutti i brani').fill(genre);
  await page.getByLabel('Generi di tutti i brani').press('Enter');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByRole('link', { name: genre })).toBeVisible();
  const tracks = (await albumOf(page, albumId)).tracks;
  expect(tracks.every((t) => t.genres.includes(genre))).toBe(true);

  await page.getByRole('link', { name: 'La tua Libreria' }).click();
  await page.getByRole('link', { name: 'Generi', exact: true }).click();
  await page.getByRole('link', { name: new RegExp(genre) }).click();
  await expect(page.getByRole('heading', { name: genre })).toBeVisible();
  await page.getByRole('button', { name: 'Riproduci in ordine casuale' }).click();
  const ids = new Set(tracks.map((t) => t.id));
  await expect
    .poll(async () => {
      const src = (await audioState(page)).src ?? '';
      return [...ids].some((id) => src.includes(id));
    })
    .toBe(true);
});
