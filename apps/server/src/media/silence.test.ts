import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SILENCE_MARGIN_MS } from '@spookyfy/shared';
import { afterEach, expect, test } from 'vitest';
import { createSilenceAnalyzer, ffmpegBinary, parseSilencedetect } from './silence.js';

const header = `Input #0, mp3, from 'a.mp3':
  Duration: 00:03:39.12, start: 0.025057, bitrate: 320 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s
`;
const line = (s: string) => `[silencedetect @ 0x55d0c8a0] ${s}\n`;

test('silenzio iniziale e finale (con silence_end alla fine del file)', () => {
  const out = parseSilencedetect(
    header +
      line('silence_start: 0') +
      line('silence_end: 7.52 | silence_duration: 7.52') +
      line('silence_start: 120.5') +
      line('silence_end: 126 | silence_duration: 5.5') +
      line('silence_start: 205.3') +
      line('silence_end: 219.12 | silence_duration: 13.82'),
  );
  expect(out?.leadingMs).toBeCloseTo(7520);
  expect(out?.trailingMs).toBeCloseTo(13_820);
  expect(out?.durationMs).toBeCloseTo(219_120);
});

test('silenzio finale senza silence_end (ffmpeg meno recenti)', () => {
  const out = parseSilencedetect(header + line('silence_start: 200.12'));
  expect(out?.leadingMs).toBe(0);
  expect(out?.trailingMs).toBeCloseTo(19_000);
});

test('durate discordanti (MP3 VBR): fa fede la fine reale del silenzio', () => {
  // Intestazione 25,05 s, decodificato 24,97 s, silenzio finale fino a 25,0002 s (output reale di ffmpeg 6).
  const out = parseSilencedetect(
    '  Duration: 00:00:25.05, start: 0.025057, bitrate: 64 kb/s\n' +
      line('silence_start: 0') +
      line('silence_end: 7.00002 | silence_duration: 7.00002') +
      line('silence_start: 17') +
      line('silence_end: 25.0002 | silence_duration: 8.00025') +
      'size=N/A time=00:00:24.97 bitrate=N/A speed=1.87e+03x\r\n',
  );
  expect(out?.leadingMs).toBeCloseTo(7000, 0);
  expect(out!.durationMs - out!.trailingMs).toBeCloseTo(17_000, 0);
});

test('una pausa a metà brano non conta', () => {
  const out = parseSilencedetect(
    header + line('silence_start: 100') + line('silence_end: 110 | silence_duration: 10'),
  );
  expect(out).toEqual({ leadingMs: 0, trailingMs: 0, durationMs: 219_120 });
});

test('file tutto silenzioso: un solo silenzio, nessun silenzio finale separato', () => {
  const out = parseSilencedetect(
    header + line('silence_start: 0') + line('silence_end: 219.12 | silence_duration: 219.12'),
  );
  expect(out?.leadingMs).toBeCloseTo(219_120);
  expect(out?.trailingMs).toBe(0);
});

test('output senza durata: analisi non riuscita', () => {
  expect(parseSilencedetect('Invalid data found when processing input')).toBeNull();
});

test('ffmpeg mancante: nessun trim, nessun errore', async () => {
  const analyze = createSilenceAnalyzer({ ffmpegPath: path.join(os.tmpdir(), 'ffmpeg-che-non-esiste') });
  await expect(analyze('qualsiasi.mp3')).resolves.toBeNull();
});

// Con un ffmpeg vero (CI, server di casa; in locale FFMPEG_PATH=…) si verifica l'intera catena.
const ffmpeg = ffmpegBinary(process.env.FFMPEG_PATH);
const hasFfmpeg = spawnSync(ffmpeg, ['-version']).status === 0;
let dir: string | undefined;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

test.skipIf(!hasFfmpeg)('con ffmpeg: 7 s di silenzio, 10 s di tono, 8 s di silenzio', async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-silence-'));
  const file = path.join(dir, 'brano.mp3');
  const silence = (d: number) => ['-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono:d=${d}`];
  const made = spawnSync(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    ...silence(7),
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100:duration=10',
    ...silence(8),
    '-filter_complex',
    '[0][1][2]concat=n=3:v=0:a=1',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '4',
    file,
  ]);
  expect(made.status, made.stderr.toString()).toBe(0);

  const trim = await createSilenceAnalyzer({ ffmpegPath: process.env.FFMPEG_PATH })(file);
  expect(trim?.trimStartMs).toBeGreaterThanOrEqual(7000 - SILENCE_MARGIN_MS - 100);
  expect(trim?.trimStartMs).toBeLessThanOrEqual(7000 - SILENCE_MARGIN_MS + 100);
  expect(trim?.trimEndMs).toBeGreaterThanOrEqual(17_000 + SILENCE_MARGIN_MS - 100);
  expect(trim?.trimEndMs).toBeLessThanOrEqual(17_000 + SILENCE_MARGIN_MS + 150);
});
