import type { SpotifyEntityDto, SpotifyStatusDto } from '@spookyfy/shared';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { type TestServices, makeTrack, setupServices } from '../test/fixtures';
import Dialogs from './Dialogs.svelte';
import FullPlayer from './FullPlayer.svelte';
import MiniPlayer from './MiniPlayer.svelte';
import SpotifyBrowser from './SpotifyBrowser.svelte';
import SpotifyPlayer from './SpotifyPlayer.svelte';
import SpotifySettings from './SpotifySettings.svelte';

const status: SpotifyStatusDto = {
  mode: 'fake',
  linkState: 'linked',
  accountId: 'account',
  displayName: 'Test Spotify',
  entitlement: 'unknown',
  scopes: [],
  generation: 1,
  capabilities: {
    canBrowse: true,
    canEditLibrary: true,
    canEditPlaylist: true,
    canStream: true,
    canHybridPlayback: false,
    canDownload: false,
    canEditTags: false,
  },
};
const entity = (name: string, kind: SpotifyEntityDto['kind'] = 'track'): SpotifyEntityDto => ({
  kind,
  id: 'a'.repeat(22),
  uri: `spotify:${kind}:${'a'.repeat(22)}`,
  name,
  artists: ['Test artist'],
  imageUrl: null,
  externalUrl: 'https://open.spotify.com',
  available: true,
  durationMs: 10000,
  album: null,
});
let s: TestServices;
beforeEach(async () => {
  s = await setupServices();
  s.spotify.status = status;
});

test.each(['disabled', 'misconfigured'] as const)(
  'a previously linked account can still be unlinked when Spotify is %s',
  async (mode) => {
    s.spotify.status = { ...status, mode };
    const unlink = vi.spyOn(s.spotify, 'unlink').mockResolvedValue(undefined);
    render(SpotifySettings);
    await fireEvent.click(screen.getByRole('button', { name: 'Scollega Spotify' }));
    expect(unlink).toHaveBeenCalledOnce();
  },
);

test('local occurrence transport and Media Session skip the hybrid queue while legacy playback stays unchanged', async () => {
  const audio = document.createElement('audio');
  s.player.attach(audio);
  s.spotify.status = { ...status, capabilities: { ...status.capabilities, canHybridPlayback: true } };
  const tracks = [makeTrack({ title: 'First local' }), makeTrack({ title: 'Second local' })];
  s.spotify.playOccurrences(
    tracks.map((local, index) => ({
      occurrenceId: `local-${index}`,
      ref: { provider: 'local' as const, trackId: local.id },
      local,
    })),
  );
  s.router.openOverlay('player');
  render(FullPlayer);
  render(MiniPlayer);
  expect(screen.getByText('Raccolta Spookyfy · File locale')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Brano successivo' }));
  expect(s.spotify.occurrenceIndex).toBe(1);
  expect(s.player.current?.title).toBe('Second local');
  await fireEvent.click(screen.getByRole('button', { name: 'Brano precedente' }));
  expect(s.spotify.occurrenceIndex).toBe(0);
  expect(s.player.current?.title).toBe('First local');
  s.player.pause();
  s.player.resume();
  expect(s.spotify.occurrences).toHaveLength(2);
  s.media.handlers.nexttrack?.({ action: 'nexttrack' });
  expect(s.spotify.occurrenceIndex).toBe(1);
  expect(s.player.current?.title).toBe('Second local');
  s.media.handlers.previoustrack?.({ action: 'previoustrack' });
  expect(s.spotify.occurrenceIndex).toBe(0);
  s.player.playTracks(tracks);
  expect(s.spotify.occurrences).toHaveLength(0);
  s.player.next();
  expect(s.player.current?.title).toBe('Second local');
  s.player.detach();
});

test.each([true, false])(
  'Spotify artwork/artists stay attributed and %s playing state respects pause/resume disallow',
  async (playing) => {
    const track = {
      ...entity('Artwork track'),
      kind: 'track' as const,
      durationMs: 10000,
      album: 'Album',
      available: true,
      imageUrl: 'https://i.scdn.co/image/test',
    };
    s.spotify.active = true;
    s.spotify.current = track;
    s.spotify.phase = playing ? 'playing' : 'paused';
    s.spotify.remote = {
      device: null,
      track,
      playing,
      positionMs: 0,
      shuffle: false,
      repeat: 'off',
      disallows: { pausing: playing, resuming: !playing },
    };
    const request = vi.spyOn(s.spotify.api, 'request').mockResolvedValue(undefined);
    render(SpotifyPlayer);
    expect(screen.getByRole('img', { name: 'Copertina di Artwork track su Spotify' })).toHaveAttribute(
      'src',
      track.imageUrl,
    );
    expect(screen.getByRole('link', { name: 'Artisti su Spotify: Test artist' })).toHaveAttribute(
      'href',
      track.externalUrl,
    );
    const button = screen.getByRole('button', { name: playing ? 'Pausa Spotify' : 'Riprendi Spotify' });
    expect(button).toBeDisabled();
    await fireEvent.click(button);
    expect(request).not.toHaveBeenCalled();
    await expect(s.spotify.command({ action: playing ? 'pause' : 'resume' })).rejects.toThrow(
      'Comando non consentito',
    );
    s.router.openOverlay('player');
    expect(await screen.findByRole('button', { name: 'Chiudi player Spotify' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Copertina di Artwork track su Spotify' })).toHaveAttribute(
      'width',
      '224',
    );
  },
);

test('Premium unknown stays explicit and linking requires local authentication + consent', async () => {
  s.spotify.status = { ...status, linkState: 'unlinked' };
  const link = vi.spyOn(s.spotify, 'link').mockResolvedValue();
  render(SpotifySettings);
  const button = screen.getByRole('button', { name: 'Collega Spotify' });
  expect(button).toBeDisabled();
  await fireEvent.click(screen.getByRole('checkbox'));
  await fireEvent.click(button);
  expect(link).toHaveBeenCalledWith('library');
});

test('native rename preserves existing description and visibility unless explicitly edited', async () => {
  const playlist = {
    ...entity('Existing playlist', 'playlist'),
    editable: true,
    contentsAvailable: true,
    description: 'Keep this description',
    public: true,
  };
  const request = vi
    .spyOn(s.spotify.api, 'request')
    .mockImplementation((action, method) =>
      Promise.resolve(
        action === 'library'
          ? { items: [playlist], nextOffset: null, total: 1 }
          : method === 'PATCH'
            ? undefined
            : { entity: playlist },
      ),
    );
  render(SpotifyBrowser);
  await fireEvent.click(screen.getByRole('button', { name: 'Carica libreria Spotify' }));
  await fireEvent.click(await screen.findByRole('button', { name: 'Existing playlist Test artist' }));
  expect(screen.getByRole('textbox', { name: 'Descrizione playlist Spotify' })).toHaveValue(
    'Keep this description',
  );
  expect(
    screen.getByRole('checkbox', { name: 'Rendi pubblica su Spotify (solo se modificato)' }),
  ).toBeChecked();
  await fireEvent.input(screen.getByRole('textbox', { name: 'Nome playlist Spotify' }), {
    target: { value: 'New name' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Aggiorna metadati Spotify' }));
  expect(request).toHaveBeenCalledWith('playlist', 'PATCH', { id: playlist.id, name: 'New name' });
});

test('unknown Premium is not described as Free; unlink cleans provider state', async () => {
  const unlink = vi.spyOn(s.spotify, 'unlink').mockResolvedValue();
  render(SpotifySettings);
  expect(screen.getByText('Spotify richiede Premium; abbonamento non verificabile.')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Scollega Spotify' }));
  expect(unlink).toHaveBeenCalledOnce();
});

test('Spotify search cancels/discards obsolete responses and has original attribution', async () => {
  let first: ((value: unknown) => void) | undefined;
  const request = vi.spyOn(s.spotify.api, 'request').mockImplementation((_action, _method, _body, query) =>
    query?.q === 'first'
      ? new Promise((resolve) => {
          first = resolve;
        })
      : Promise.resolve({ items: [entity('New result')], total: 1, nextOffset: null }),
  );
  render(SpotifyBrowser, { search: true });
  const input = screen.getByRole('searchbox', { name: 'Ricerca Spotify' });
  await fireEvent.input(input, { target: { value: 'first' } });
  await fireEvent.submit(screen.getByRole('search', { name: 'Cerca su Spotify' }));
  await fireEvent.input(input, { target: { value: 'second' } });
  await fireEvent.submit(screen.getByRole('search', { name: 'Cerca su Spotify' }));
  expect(await screen.findByRole('button', { name: 'New result Test artist' })).toBeInTheDocument();
  first?.({ items: [entity('Obsolete')], total: 1, nextOffset: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText('Obsolete')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Apri su Spotify' })).toHaveAttribute(
    'href',
    'https://open.spotify.com',
  );
  expect(request).toHaveBeenCalledTimes(2);
});

test('limited playlist is not shown as an empty editable playlist', async () => {
  const playlist = { ...entity('Limited playlist', 'playlist'), editable: false, contentsAvailable: false };
  vi.spyOn(s.spotify.api, 'request').mockImplementation((action) =>
    Promise.resolve(
      action === 'library' ? { items: [playlist], nextOffset: null, total: 1 } : { entity: playlist },
    ),
  );
  render(SpotifyBrowser);
  await fireEvent.click(screen.getByRole('button', { name: 'Carica libreria Spotify' }));
  await fireEvent.click(await screen.findByRole('button', { name: 'Limited playlist Test artist' }));
  expect(
    await screen.findByText('Accesso agli elementi limitato. La playlist non è necessariamente vuota.'),
  ).toBeInTheDocument();
  expect(screen.getByText('Playlist Spotify in sola lettura.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /download|tag/i })).not.toBeInTheDocument();
});

test('native duplicate removal requires explicit remove-all confirmation and sends URI+snapshot once', async () => {
  const track = entity('Duplicated');
  const playlist = {
    ...entity('Native playlist', 'playlist'),
    editable: true,
    contentsAvailable: true,
    snapshotId: 'snapshot',
  };
  const request = vi.spyOn(s.spotify.api, 'request').mockImplementation((action, method) =>
    Promise.resolve(
      action === 'library'
        ? { items: [playlist], nextOffset: null, total: 1 }
        : method === 'DELETE'
          ? undefined
          : {
              entity: playlist,
              items: {
                items: [
                  { itemId: 'one', position: 0, track },
                  { itemId: 'two', position: 1, track },
                ],
                total: 2,
                nextOffset: null,
                contentsAvailable: true,
              },
            },
    ),
  );
  render(SpotifyBrowser);
  render(Dialogs);
  await fireEvent.click(screen.getByRole('button', { name: 'Carica libreria Spotify' }));
  await fireEvent.click(await screen.findByRole('button', { name: 'Native playlist Test artist' }));
  const remove = await screen.findAllByRole('button', {
    name: 'Rimuovi tutte le occorrenze di questo brano',
  });
  expect(remove).toHaveLength(2);
  await fireEvent.click(remove[0]!);
  expect(request).not.toHaveBeenCalledWith('playlist-items', 'DELETE', expect.anything());
  await fireEvent.click(screen.getByRole('button', { name: 'Rimuovi tutte le occorrenze' }));
  expect(request).toHaveBeenCalledWith('playlist-items', 'DELETE', {
    id: playlist.id,
    uris: [track.uri],
    snapshotId: 'snapshot',
  });
});

test.each(['playlist', 'album'] as const)(
  'native %s playback retains context and selected track',
  async (kind) => {
    const track = entity('Selected track');
    const parent = { ...entity('Native context', kind), contentsAvailable: true };
    const play = vi.spyOn(s.spotify, 'play').mockImplementation(() => {});
    vi.spyOn(s.spotify.api, 'request').mockImplementation((action) =>
      Promise.resolve(
        action === 'library'
          ? { items: [parent], nextOffset: null, total: 1 }
          : {
              entity: parent,
              items: {
                items: kind === 'playlist' ? [{ itemId: 'one', position: 0, track }] : [track],
                nextOffset: null,
                total: 1,
                ...(kind === 'playlist' ? { contentsAvailable: true } : {}),
              },
            },
      ),
    );
    render(SpotifyBrowser);
    await fireEvent.click(screen.getByRole('button', { name: 'Carica libreria Spotify' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Native context Test artist' }));
    await fireEvent.click(await screen.findByRole('button', { name: `Riproduci ${kind} su Spotify` }));
    expect(play).toHaveBeenLastCalledWith(track, parent.uri);
    await fireEvent.click(
      screen.getByRole('button', {
        name: kind === 'playlist' ? 'Riproduci' : 'Riproduci Selected track su Spotify',
      }),
    );
    expect(play).toHaveBeenLastCalledWith(track, parent.uri);
  },
);
