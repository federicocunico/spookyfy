import { describe, expect, test } from 'vitest';
import { cleanMetadata, cleanTitle } from './metadata.js';

describe('cleanMetadata', () => {
  test.each([
    [
      'campi musicali di YouTube Music',
      {
        id: 'a',
        title: 'Come As You Are',
        track: 'Come As You Are',
        artist: 'Nirvana',
        album: 'Nevermind',
        uploader: 'Nirvana - Topic',
      },
      { title: 'Come As You Are', artist: 'Nirvana', album: 'Nevermind' },
    ],
    [
      'artisti multipli',
      { id: 'a', title: 'x', track: 'Under Pressure', artists: ['Queen', 'David Bowie'] },
      { title: 'Under Pressure', artist: 'Queen, David Bowie', album: null },
    ],
    [
      'canale VEVO con "Artista - Titolo (Official Music Video)"',
      { id: 'a', title: 'Nirvana - Come As You Are (Official Music Video)', channel: 'NirvanaVEVO' },
      { title: 'Come As You Are', artist: 'Nirvana', album: null },
    ],
    [
      'canale "- Topic" senza trattino nel titolo',
      { id: 'a', title: 'Bohemian Rhapsody', uploader: 'Queen - Topic' },
      { title: 'Bohemian Rhapsody', artist: 'Queen', album: null },
    ],
    [
      'video ufficiale italiano',
      { id: 'a', title: 'Vasco Rossi - Albachiara (Videoclip Ufficiale)', channel: 'Vasco Rossi' },
      { title: 'Albachiara', artist: 'Vasco Rossi', album: null },
    ],
    [
      'parentesi quadre e suffisso con barra',
      { id: 'a', title: 'Daft Punk - One More Time [Official Video] | HD', channel: 'Daft Punk' },
      { title: 'One More Time', artist: 'Daft Punk', album: null },
    ],
    [
      'testo e lyrics',
      { id: 'a', title: 'Sfera Ebbasta - Tran Tran (Testo)', channel: 'x' },
      { title: 'Tran Tran', artist: 'Sfera Ebbasta', album: null },
    ],
    [
      'titolo tra virgolette',
      { id: 'a', title: 'Radiohead - "Creep"', channel: 'Radiohead' },
      { title: 'Creep', artist: 'Radiohead', album: null },
    ],
    [
      'le informazioni utili (remix, live) restano',
      { id: 'a', title: 'Song (Live at Wembley) (Official Audio)', channel: 'Band Official' },
      { title: 'Song (Live at Wembley)', artist: 'Band', album: null },
    ],
    [
      'senza canale',
      { id: 'abc', title: 'Qualcosa' },
      { title: 'Qualcosa', artist: 'Artista sconosciuto', album: null },
    ],
  ])('%s', (_name, info, expected) => {
    expect(cleanMetadata(info)).toEqual(expected);
  });
});

test('un titolo fatto solo di "rumore" non diventa vuoto', () => {
  expect(cleanTitle('(Official Video)')).toBe('(Official Video)');
});
