import { describe, expect, test } from 'vitest';
import {
  albumKey,
  commonGenres,
  createAlbumBodySchema,
  normalizeGenres,
  splitGenres,
  trackGenresBodySchema,
  updateAlbumBodySchema,
} from './catalog.js';

describe('albumKey', () => {
  test('senza accenti, maiuscole e spazi superflui', () => {
    expect(albumKey('  Björk   Homogenic ')).toBe('bjork homogenic');
    expect(albumKey('IN UTERO')).toBe(albumKey('in utero'));
  });

  test('le diciture di edizione restano: edizioni diverse, album diversi', () => {
    expect(albumKey('Nevermind (Remastered)')).not.toBe(albumKey('Nevermind'));
  });
});

describe('generi', () => {
  test('valori multipli dai tag', () => {
    expect(splitGenres('Alternative; Indie')).toEqual(['Alternative', 'Indie']);
    expect(splitGenres(['Rock', 'Pop,Rock'])).toEqual(['Rock', 'Pop']);
    expect(splitGenres('Jazz\u0000Swing')).toEqual(['Jazz', 'Swing']);
  });

  test('codici numerici ID3 scartati, nomi con codice ripuliti', () => {
    expect(splitGenres('(17)')).toEqual([]);
    expect(splitGenres('17')).toEqual([]);
    expect(splitGenres('(17)Rock')).toEqual(['Rock']);
  });

  test('nomi vuoti o troppo lunghi ignorati, massimo 10', () => {
    expect(splitGenres('   ;  ')).toEqual([]);
    expect(splitGenres('x'.repeat(41))).toEqual([]);
    expect(splitGenres(Array.from({ length: 12 }, (_, i) => `G${i}`).join(';'))).toHaveLength(10);
    expect(splitGenres(null)).toEqual([]);
  });

  test('"hip-hop" prende la grafia già in uso "Hip-Hop"', () => {
    expect(normalizeGenres(['hip-hop'], ['Hip-Hop'])).toEqual(['Hip-Hop']);
    expect(normalizeGenres(['Elettronica', 'elettronica', 'ÉLETTRONICA'])).toEqual(['Elettronica']);
  });

  test('generi comuni a tutti i brani', () => {
    expect(commonGenres([['Rock', 'Acustico'], ['rock'], ['Rock', 'Pop']])).toEqual(['Rock']);
    expect(commonGenres([])).toEqual([]);
  });

  test('validazione dei generi di un brano', () => {
    expect(trackGenresBodySchema.parse({ genres: ['  Post   rock '] }).genres).toEqual(['Post rock']);
    expect(trackGenresBodySchema.safeParse({ genres: ['   '] }).success).toBe(false);
    expect(
      trackGenresBodySchema.safeParse({ genres: Array.from({ length: 11 }, (_, i) => `g${i}`) }).success,
    ).toBe(false);
  });
});

describe('validazione degli album', () => {
  test('titolo 1–200 caratteri, anno 1000–2100', () => {
    expect(createAlbumBodySchema.safeParse({ title: 'Demo 2026' }).success).toBe(true);
    expect(createAlbumBodySchema.safeParse({ title: '  ' }).success).toBe(false);
    expect(createAlbumBodySchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);
    expect(createAlbumBodySchema.safeParse({ title: 'A', year: 999 }).success).toBe(false);
    expect(createAlbumBodySchema.safeParse({ title: 'A', year: 2101 }).success).toBe(false);
    expect(createAlbumBodySchema.safeParse({ title: 'A', year: null }).success).toBe(true);
  });

  test('una modifica senza campi è rifiutata', () => {
    expect(updateAlbumBodySchema.safeParse({}).success).toBe(false);
    expect(updateAlbumBodySchema.safeParse({ year: null }).success).toBe(true);
  });
});
