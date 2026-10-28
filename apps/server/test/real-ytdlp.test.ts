import fs from 'node:fs';
import path from 'node:path';
import { cleanMetadata } from '@spookyfy/shared';
import { afterAll, expect, test } from 'vitest';
import { processCover } from '../src/ingest/covers.js';
import { createYtDlp } from '../src/ingest/ytdlp.js';
import { readTags, writeTags } from '../src/media/tags.js';
import { makeTempDir } from './helpers.js';

/**
 * Importazione reale con yt-dlp e ffmpeg installati (task 6.9). Disattivato di
 * default perché scarica da YouTube:
 *
 *   SPOOKYFY_REAL_YTDLP=1 pnpm --filter @spookyfy/server exec vitest run test/real-ytdlp.test.ts
 *
 * Variabili opzionali: YTDLP_PATH, FFMPEG_PATH, SPOOKYFY_REAL_VIDEO_ID.
 */
const enabled = process.env.SPOOKYFY_REAL_YTDLP === '1';
const dir = enabled ? makeTempDir('spk-real-') : '';
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test.skipIf(!enabled)(
  'importazione reale: MP3 con titolo, artista e copertina leggibili',
  async () => {
    const yt = createYtDlp({
      command: process.env.YTDLP_PATH ?? 'yt-dlp',
      ffmpegPath: process.env.FFMPEG_PATH,
    });
    const results = await yt.search('Me at the zoo');
    expect(results.length).toBeGreaterThan(0);

    const id = process.env.SPOOKYFY_REAL_VIDEO_ID ?? 'jNQXAC9IVRw'; // "Me at the zoo", 19 s
    const dl = await yt.download(id, path.join(dir, 'job'));
    const meta = cleanMetadata(dl.info);
    const cover = await processCover(dl.thumbnailFile);
    await writeTags(dl.audioFile, { ...meta, cover: cover.large });

    const tags = await readTags(dl.audioFile);
    expect(tags.title).toBe(meta.title);
    expect(tags.artist).toBe(meta.artist);
    expect((tags.image as { mime: string }).mime).toBe('image/jpeg');
    expect(fs.statSync(dl.audioFile).size).toBeGreaterThan(10_000);
    console.info('Importato:', meta, 'colore', cover.dominantColor);
  },
  120_000,
);
