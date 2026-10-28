import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, test } from 'vitest';
import { silentMp3, solidJpeg } from '../../test/fixtures/media.js';
import { makeTempDir } from '../../test/helpers.js';
import { readTags, writeTags } from '../media/tags.js';
import { processCover, rgbToHex } from './covers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

test('ritagli 512/128 quadrati e colore dominante', async () => {
  const cover = await processCover(await solidJpeg('#d02020', 480, 360));
  const large = await sharp(cover.large).metadata();
  const thumb = await sharp(cover.thumb).metadata();
  expect([large.width, large.height, large.format]).toEqual([512, 512, 'jpeg']);
  expect([thumb.width, thumb.height]).toEqual([128, 128]);
  expect(cover.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(cover.dominantColor.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
  expect(r).toBeGreaterThan(150);
  expect(g).toBeLessThan(80);
  expect(b).toBeLessThan(80);
});

test('copertina di riserva senza miniatura', async () => {
  const cover = await processCover(undefined);
  expect((await sharp(cover.large).metadata()).width).toBe(512);
});

test('rgbToHex', () => {
  expect(rgbToHex(255, 95, 31)).toBe('#ff5f1f');
});

test('tag ID3 con titolo, artista, album e copertina leggibili', async () => {
  const dir = makeTempDir();
  dirs.push(dir);
  const file = path.join(dir, 'a.mp3');
  fs.writeFileSync(file, silentMp3(2));
  const cover = await processCover(await solidJpeg('#2040d0'));
  await writeTags(file, {
    title: 'Come As You Are',
    artist: 'Nirvana',
    album: 'Nevermind',
    cover: cover.large,
  });
  const tags = await readTags(file);
  expect(tags).toMatchObject({ title: 'Come As You Are', artist: 'Nirvana', album: 'Nevermind' });
  const image = tags.image as { mime: string; imageBuffer: Buffer };
  expect(image.mime).toBe('image/jpeg');
  expect(image.imageBuffer.equals(cover.large)).toBe(true);
});
