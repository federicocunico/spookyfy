import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { fakeYtDlp } from '../../test/fixtures/fake-ytdlp.js';
import { makeTempDir } from '../../test/helpers.js';
import { YtDlpError, createYtDlp, parseSearchOutput } from './ytdlp.js';

const dirs: string[] = [];
const tmp = () => {
  const d = makeTempDir('spk-ytdlp-');
  dirs.push(d);
  return path.join(d, 'job');
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('ricerca', () => {
  test('restituisce al massimo 10 risultati ed esclude le dirette', async () => {
    const items = await fakeYtDlp().search('nirvana come as you are');
    expect(items).toHaveLength(10);
    expect(items[0]).toEqual({
      sourceId: 'srch0000000',
      title: 'nirvana come as you are risultato 0',
      channel: 'Canale 0',
      durationSec: 180,
      thumbnailUrl: 'https://i.ytimg.com/vi/x0/default.jpg',
    });
  });

  test('la query non viene interpretata da una shell', async () => {
    const items = await fakeYtDlp().search('a; rm -rf / && echo "$(whoami)"');
    expect(items[0]!.title).toBe('a; rm -rf / && echo "$(whoami)" risultato 0');
  });

  test('errore della sorgente', async () => {
    await expect(fakeYtDlp().search('fail')).rejects.toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('429'),
    });
  });

  test('timeout', async () => {
    await expect(fakeYtDlp({ searchTimeoutMs: 500 }).search('timeout')).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  test('eseguibile mancante', async () => {
    await expect(createYtDlp({ command: 'spk-yt-dlp-inesistente' }).search('x')).rejects.toMatchObject({
      kind: 'not_installed',
    });
  });

  test('miniatura di riserva', () => {
    const out = parseSearchOutput(
      JSON.stringify({ entries: [{ id: 'abcdefghijk', title: 't' }, { id: 'corto' }] }),
    );
    expect(out).toEqual([
      {
        sourceId: 'abcdefghijk',
        title: 't',
        channel: '',
        durationSec: null,
        thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
      },
    ]);
  });
});

describe('download', () => {
  test('produce mp3, miniatura e metadati con avanzamento', async () => {
    const progress: number[] = [];
    const res = await fakeYtDlp().download('abcdefghijk', tmp(), { onProgress: (p) => progress.push(p) });
    expect(fs.existsSync(res.audioFile)).toBe(true);
    expect(res.thumbnailFile && fs.existsSync(res.thumbnailFile)).toBe(true);
    expect(res.info.title).toContain('Official Video');
    expect(progress).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  test('video non disponibile', async () => {
    await expect(fakeYtDlp().download('unavail0000', tmp())).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'Il video non è disponibile',
    });
  });

  test('video troppo lungo', async () => {
    await expect(fakeYtDlp().download('toolong0000', tmp())).rejects.toMatchObject({
      kind: 'too_long',
      message: expect.stringContaining('20 minuti'),
    });
  });

  test('annullamento', async () => {
    const ac = new AbortController();
    const p = fakeYtDlp().download('slow0000000', tmp(), { signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    await expect(p).rejects.toBeInstanceOf(YtDlpError);
    await expect(p).rejects.toMatchObject({ kind: 'aborted' });
  });

  test('id non valido rifiutato senza eseguire nulla', async () => {
    await expect(fakeYtDlp().download('--exec=evil', tmp())).rejects.toMatchObject({ kind: 'failed' });
  });
});
