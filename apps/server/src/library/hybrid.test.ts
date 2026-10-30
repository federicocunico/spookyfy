import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, test } from 'vitest';
import { openDatabase } from '../db/client.js';
import { HybridPlaylistService } from './hybrid.js';

test('migration upgrades populated legacy catalog without touching files/playlists', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'spookyfy-hybrid-'));
  const migrations = path.join(directory, 'drizzle');
  const source = path.resolve(import.meta.dirname, '../../drizzle');
  try {
    cpSync(source, migrations, { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrations, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.slice(0, 5);
    writeFileSync(path.join(migrations, 'meta/_journal.json'), JSON.stringify(journal));
    const file = path.join(directory, 'library.sqlite');
    const sqlite = new Database(file);
    migrate(drizzle(sqlite), { migrationsFolder: migrations });
    sqlite.prepare("INSERT INTO users VALUES ('a','a','a','hash',1)").run();
    sqlite.prepare("INSERT INTO playlists VALUES ('legacy','a','Keep me',1,1)").run();
    sqlite.close();
    const upgraded = openDatabase(file);
    try {
      expect(upgraded.sqlite.prepare("SELECT name FROM playlists WHERE id='legacy'").get()).toEqual({
        name: 'Keep me',
      });
      expect(upgraded.sqlite.prepare('SELECT count(*) AS n FROM hybrid_playlists').get()).toEqual({ n: 0 });
      expect(upgraded.sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
const seed = (db: ReturnType<typeof openDatabase>) => {
  db.sqlite.prepare("INSERT INTO users VALUES ('a','a','a','hash',1),('b','b','b','hash',1)").run();
  db.sqlite
    .prepare(
      "INSERT INTO tracks(id,source,source_id,title,artist,duration_ms,size_bytes,dominant_color,audio_path,cover_path,added_at) VALUES ('t','file','t','Title','Artist',1,1,'#000000','audio','cover',1)",
    )
    .run();
};
test('additive migration preserves legacy FKs; owners, duplicates, copy and file removal', () => {
  const db = openDatabase(':memory:');
  try {
    seed(db);
    const s = new HybridPlaylistService(db.sqlite, { now: () => 1 });
    const p = s.create('a', 'P');
    s.add('a', p.id, { provider: 'local', trackId: 't' });
    const full = s.add('a', p.id, { provider: 'local', trackId: 't' });
    expect(full.items).toHaveLength(2);
    expect(() => s.get('b', p.id)).toThrow();
    s.move('a', p.id, full.items[1]!.itemId, 0);
    expect(s.get('a', p.id).items[0]!.itemId).toBe(full.items[1]!.itemId);
    s.remove('a', p.id, full.items[0]!.itemId);
    expect(s.get('a', p.id).items).toHaveLength(1);
    db.sqlite.prepare("INSERT INTO playlists VALUES ('old','a','Old',1,1)").run();
    db.sqlite.prepare("INSERT INTO playlist_items VALUES ('old-item','old','t',1,1)").run();
    const copy = s.copyLegacy('a', 'old');
    expect(copy.items).toHaveLength(1);
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM playlist_items').get()).toEqual({ n: 1 });
    db.sqlite.prepare("DELETE FROM tracks WHERE id='t'").run();
    expect(s.get('a', p.id).items).toEqual([]);
    expect(s.get('a', copy.id).items).toEqual([]);
    expect(db.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    db.close();
  }
});
test('remote refs require current account and purge preserves local occurrences', () => {
  const db = openDatabase(':memory:');
  try {
    seed(db);
    const s = new HybridPlaylistService(db.sqlite, { now: () => 1 });
    const p = s.create('a', 'P');
    const ref = { provider: 'spotify' as const, uri: 'spotify:track:0123456789012345678901' };
    expect(() => s.add('a', p.id, ref, 'remote')).toThrow();
    db.sqlite
      .prepare(
        "INSERT INTO spotify_links(user_id,account_id,envelope,scopes,expires_at,authorized_at) VALUES ('a','remote','encrypted','[]',1,1)",
      )
      .run();
    s.add('a', p.id, ref, 'remote');
    const count = s.list('a').length;
    expect(() => s.copySpotify('a', 'Copy', 'remote', 1, [ref])).toThrow();
    expect(() =>
      s.copySpotify('a', 'Copy', 'remote', 0, [ref, { provider: 'spotify', uri: 'invalid' }]),
    ).toThrow();
    expect(s.list('a')).toHaveLength(count);
    const copied = s.copySpotify('a', 'Copy', 'remote', 0, [ref, ref]);
    expect(copied.items).toHaveLength(2);
    expect(copied.items[0]!.itemId).not.toBe(copied.items[1]!.itemId);
    expect(s.rename('a', copied.id, 'Renamed').name).toBe('Renamed');
    s.add('a', p.id, { provider: 'local', trackId: 't' });
    s.purgeSpotify('a', 'other');
    expect(s.get('a', p.id).items).toHaveLength(2);
    s.purgeSpotify('a', 'remote');
    expect(s.get('a', p.id).items).toHaveLength(1);
    expect(() =>
      db.sqlite
        .prepare("INSERT INTO hybrid_playlist_items VALUES ('bad',?,'spotify','t','invalid','remote',1,1)")
        .run(p.id),
    ).toThrow();
  } finally {
    db.close();
  }
});
