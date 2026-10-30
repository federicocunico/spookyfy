import { describe, expect, test } from 'vitest';
import { mediaKey, mediaRefSchema, spotifyPlaybackCommandSchema } from './providers.js';

describe('riferimenti multisorgente', () => {
  const id = '0123456789ABCDEFGHIJKL';
  test('identità separate e nessun payload con campi di altra sorgente', () => {
    const local = mediaRefSchema.parse({ provider: 'local', trackId: id });
    const remote = mediaRefSchema.parse({ provider: 'spotify', uri: `spotify:track:${id}` });
    expect(mediaKey(local)).not.toBe(mediaKey(remote));
    expect(mediaRefSchema.safeParse({ ...local, uri: remote.uri }).success).toBe(false);
    expect(mediaRefSchema.safeParse({ ...remote, audioUrl: '/audio.mp3' }).success).toBe(false);
    expect(mediaRefSchema.safeParse({ provider: 'spotify', uri: `spotify:album:${id}` }).success).toBe(false);
  });
  test('i comandi richiedono parametri coerenti', () => {
    expect(spotifyPlaybackCommandSchema.safeParse({ action: 'seek' }).success).toBe(false);
    expect(spotifyPlaybackCommandSchema.safeParse({ action: 'seek', positionMs: 0 }).success).toBe(true);
    expect(spotifyPlaybackCommandSchema.safeParse({ action: 'transfer' }).success).toBe(false);
    expect(
      spotifyPlaybackCommandSchema.safeParse({ action: 'pause', url: 'https://evil.test' }).success,
    ).toBe(false);
    expect(
      spotifyPlaybackCommandSchema.safeParse({ action: 'play', offsetUri: `spotify:track:${id}` }).success,
    ).toBe(false);
    expect(
      spotifyPlaybackCommandSchema.safeParse({
        action: 'play',
        contextUri: `spotify:playlist:${id}`,
        offsetUri: `spotify:track:${id}`,
      }).success,
    ).toBe(true);
  });
});
