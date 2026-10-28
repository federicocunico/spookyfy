import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { makeTempDir } from '../../test/helpers.js';
import { openDatabase } from './client.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

test('le migrazioni si applicano su un DB vuoto e sono idempotenti', () => {
  const dir = makeTempDir();
  dirs.push(dir);
  const file = path.join(dir, 'nested', 'spk.db');

  const first = openDatabase(file);
  const tables = first.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name);
  expect(tables).toEqual(
    expect.arrayContaining([
      'users',
      'sessions',
      'tracks',
      'ingest_jobs',
      'favorites',
      'playlists',
      'playlist_items',
      'plays',
      'tracks_fts',
    ]),
  );
  expect(first.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
  expect(first.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  const applied = first.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as {
    n: number;
  };
  first.close();

  const second = openDatabase(file);
  const again = second.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as {
    n: number;
  };
  expect(again.n).toBe(applied.n);
  second.close();
});

test('l’indice FTS segue inserimenti, modifiche ed eliminazioni', () => {
  const { sqlite, close } = openDatabase(':memory:');
  const insert = sqlite.prepare(
    `INSERT INTO tracks (id, source, source_id, title, artist, album, duration_ms, size_bytes, dominant_color, audio_path, cover_path, added_at)
     VALUES (?, 'youtube', ?, ?, ?, NULL, 1000, 10, '#000000', 'a', 'c', 0)`,
  );
  insert.run('t1', 'aaaaaaaaaaa', 'Come As You Are', 'Nirvana');
  const search = (q: string) =>
    sqlite
      .prepare('SELECT track_id FROM tracks_fts WHERE tracks_fts MATCH ?')
      .all(q)
      .map((r) => (r as { track_id: string }).track_id);
  expect(search('nirv*')).toEqual(['t1']);
  sqlite.prepare("UPDATE tracks SET artist = 'Björk' WHERE id = 't1'").run();
  expect(search('nirv*')).toEqual([]);
  expect(search('bjork*')).toEqual(['t1']);
  sqlite.prepare("DELETE FROM tracks WHERE id = 't1'").run();
  expect(search('bjork*')).toEqual([]);
  close();
});
