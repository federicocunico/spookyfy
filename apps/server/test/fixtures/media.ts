import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ulid } from 'ulid';
import {
  COVER_SIZES,
  absMediaPath,
  audioRelPath,
  coverRelPath,
  coverRelPrefix,
} from '../../src/media/paths.js';
import { writeTags } from '../../src/media/tags.js';
import type { TestContext } from '../helpers.js';

/**
 * MP3 valido e silenzioso: frame MPEG-1 Layer III, 128 kbit/s, 44,1 kHz, mono,
 * con side info e main data a zero (decodificati come silenzio).
 */
export function silentMp3(seconds: number): Buffer {
  const frameLength = 417; // floor(144 * 128000 / 44100)
  const frames = Math.ceil((seconds * 44100) / 1152);
  const frame = Buffer.alloc(frameLength);
  frame.set([0xff, 0xfb, 0x90, 0xc0]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

export function solidJpeg(color: string, width = 640, height = 360): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

export interface InsertTrackOptions {
  title?: string;
  artist?: string;
  album?: string | null;
  addedAt?: number;
  durationMs?: number;
  sourceId?: string;
  dominantColor?: string;
}

let counter = 0;

/** Inserisce un brano completo (file MP3 con tag, copertine, riga nel DB). */
export async function insertTrack(ctx: TestContext, o: InsertTrackOptions = {}) {
  const id = ulid();
  const n = ++counter;
  const title = o.title ?? `Brano ${n}`;
  const artist = o.artist ?? 'Artista';
  const audio = audioRelPath(id);
  const coverPrefix = coverRelPrefix(id);
  const audioFile = absMediaPath(ctx.config.mediaDir, audio);
  fs.mkdirSync(path.dirname(audioFile), { recursive: true });
  fs.writeFileSync(audioFile, silentMp3((o.durationMs ?? 3000) / 1000));
  await writeTags(audioFile, { title, artist, album: o.album });
  for (const size of COVER_SIZES) {
    const file = absMediaPath(ctx.config.mediaDir, coverRelPath(coverPrefix, size));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await solidJpeg('#c02020', size, size));
  }
  ctx.database.sqlite
    .prepare(
      `INSERT INTO tracks (id, source, source_id, title, artist, album, duration_ms, size_bytes, dominant_color, audio_path, cover_path, added_at)
       VALUES (@id, 'youtube', @sourceId, @title, @artist, @album, @durationMs, @size, @color, @audio, @cover, @addedAt)`,
    )
    .run({
      id,
      sourceId: o.sourceId ?? `src${String(n).padStart(8, '0')}`,
      title,
      artist,
      album: o.album ?? null,
      durationMs: o.durationMs ?? 3000,
      size: fs.statSync(audioFile).size,
      color: o.dominantColor ?? '#c02020',
      audio,
      cover: coverPrefix,
      addedAt: o.addedAt ?? ctx.clock.now(),
    });
  return { id, title, artist, audioFile, coverPrefix };
}
