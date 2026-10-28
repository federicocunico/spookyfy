import { describe, expect, test } from 'vitest';
import { backupLibrarySchema, backupManifestSchema } from './backup.js';

const manifest = {
  format: 'spookyfy-backup',
  version: 1,
  exportedAt: 1_800_000_000_000,
  appVersion: '0.2.0',
  counts: { tracks: 1, playlists: 1, favorites: 1, plays: 1 },
  librarySha256: 'a'.repeat(64),
  audioParts: [
    { index: 1, fileName: 'spookyfy-backup-2026-10-28-audio-1.zip', trackIds: ['t1'], bytes: 1234 },
  ],
};

const library = {
  tracks: [
    {
      id: 't1',
      sourceKey: 'youtube:abcdefghijk',
      title: 'Song',
      artist: 'Band',
      album: null,
      durationMs: 180000,
      sizeBytes: 1234,
      mimeType: 'audio/mp4',
      dominantColor: '#c02020',
      addedAt: 1,
      cover: 'covers/t1-512.jpg',
      audioPart: 1,
    },
  ],
  favorites: [{ trackId: 't1', createdAt: 2 }],
  playlists: [{ id: 'p1', name: 'Notte', createdAt: 1, updatedAt: 2, trackIds: ['t1', 't1'] }],
  plays: [{ id: 'play-1', trackId: 't1', playedAt: 3 }],
};

describe('formato di backup v1', () => {
  test('esempio valido', () => {
    expect(backupManifestSchema.safeParse(manifest).success).toBe(true);
    expect(backupLibrarySchema.safeParse(library).success).toBe(true);
  });

  test('libreria troncata (campi mancanti) rifiutata', () => {
    const truncated = { tracks: [{ id: 't1', title: 'Song' }] };
    expect(backupLibrarySchema.safeParse(truncated).success).toBe(false);
  });

  test('versione non supportata', () => {
    const r = backupManifestSchema.safeParse({ ...manifest, version: 2 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('Versione del backup non supportata');
  });

  test('formato sconosciuto', () => {
    expect(backupManifestSchema.safeParse({ ...manifest, format: 'altro' }).success).toBe(false);
  });
});
