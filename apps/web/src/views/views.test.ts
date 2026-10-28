import type { JobDto, PlaylistDto, RemoteSearchResultDto } from '@spookyfy/shared';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Dialogs from '../components/Dialogs.svelte';
import OfflineBanner from '../components/OfflineBanner.svelte';
import TrackMenu from '../components/TrackMenu.svelte';
import { type TestServices, flush, makeTrack, setupServices } from '../test/fixtures';
import HomeView from './HomeView.svelte';
import PlaylistView from './PlaylistView.svelte';
import SearchView from './SearchView.svelte';
import SettingsView from './SettingsView.svelte';

let s: TestServices;
beforeEach(async () => {
  s = await setupServices();
});

describe('Home', () => {
  test('sezioni con i dati', async () => {
    const recent = [makeTrack({ title: 'Recente A' }), makeTrack({ title: 'Recente B' })];
    const added = [makeTrack({ title: 'Nuovo 1' })];
    s.fake.plays.recent.mockResolvedValue({ items: recent });
    s.fake.tracks.list.mockResolvedValue({ items: added, nextCursor: null });
    s.fake.playlists.list.mockResolvedValue({
      items: [
        {
          id: 'p1',
          name: 'Notte',
          trackCount: 2,
          durationMs: 1,
          coverTrackIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    render(HomeView);
    expect(await screen.findByRole('button', { name: /Riproduci Recente A/ })).toBeInTheDocument();
    expect(screen.getByText('Nuovo 1')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Notte/ })).toBeInTheDocument();
    expect(s.fake.tracks.list).toHaveBeenCalledWith({ sort: 'added', limit: 20 });
  });

  test('liste vuote', async () => {
    render(HomeView);
    expect(await screen.findByText('La libreria è vuota.')).toBeInTheDocument();
    expect(screen.getByText(/Qui troverai i brani/)).toBeInTheDocument();
  });

  test('segnaposto prima dei dati (nessuno spostamento di layout)', () => {
    s.fake.plays.recent.mockReturnValue(new Promise(() => {}));
    s.fake.tracks.list.mockReturnValue(new Promise(() => {}));
    render(HomeView);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });
});

describe('Cerca', () => {
  const result = (o: Partial<RemoteSearchResultDto> = {}): RemoteSearchResultDto => ({
    sourceId: 'abcdefghijk',
    title: 'Come As You Are',
    artist: 'Nirvana',
    durationMs: 219_000,
    thumbnailUrl: 'https://i.ytimg.com/vi/x/hq.jpg',
    trackId: null,
    ...o,
  });
  const job = (o: Partial<JobDto>): JobDto => ({
    id: 'j1',
    sourceId: 'abcdefghijk',
    status: 'queued',
    progress: 0,
    error: null,
    trackId: null,
    requestedBy: 'u1',
    createdAt: 1,
    updatedAt: 1,
    ...o,
  });

  test('ricerca locale mentre si digita e risultati YouTube su Invio', async () => {
    s.fake.tracks.list.mockResolvedValue({ items: [makeTrack({ title: 'In libreria' })], nextCursor: null });
    s.fake.remote.search.mockResolvedValue({ items: [result()] });
    render(SearchView);
    await userEvent.type(screen.getByRole('searchbox'), 'nirvana');
    expect(await screen.findByText('In libreria')).toBeInTheDocument();
    expect(s.fake.tracks.list).toHaveBeenLastCalledWith({ q: 'nirvana', limit: 20 }, expect.anything());
    await userEvent.type(screen.getByRole('searchbox'), '{Enter}');
    expect(await screen.findByText('Come As You Are')).toBeInTheDocument();
  });

  test('stati del job ricevuti in tempo reale: coda, percentuale, completato, errore e riprova', async () => {
    s.fake.remote.search.mockResolvedValue({ items: [result()] });
    s.fake.remote.ingest.mockResolvedValue({ kind: 'job', job: job({}) });
    render(SearchView);
    await userEvent.type(screen.getByRole('searchbox'), 'nirvana{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /Aggiungi Come As You Are/ }));
    expect(await screen.findByText('In coda…')).toBeInTheDocument();

    s.jobs.handleEvent({
      type: 'job.progress',
      job: job({ status: 'running', progress: 0.42, updatedAt: 2 }),
    });
    expect(await screen.findByText('Importazione 42%')).toBeInTheDocument();

    s.jobs.handleEvent({
      type: 'job.failed',
      job: job({ status: 'failed', error: 'Il video non è disponibile', updatedAt: 3 }),
    });
    expect(await screen.findByText('Il video non è disponibile')).toBeInTheDocument();
    s.fake.remote.retry.mockResolvedValue(job({ status: 'queued', updatedAt: 4 }));
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(s.fake.remote.retry).toHaveBeenCalledWith('j1');
    expect(await screen.findByText('In coda…')).toBeInTheDocument();

    const track = makeTrack({ title: 'Come As You Are' });
    s.jobs.handleEvent({
      type: 'job.completed',
      job: job({ status: 'completed', progress: 1, trackId: track.id, updatedAt: 5 }),
      track,
    });
    const play = await screen.findByRole('button', { name: 'Riproduci Come As You Are' });
    await userEvent.click(play);
    expect(s.player.current?.id).toBe(track.id);
  });

  test('brano già in libreria: si riproduce senza importare', async () => {
    s.fake.remote.search.mockResolvedValue({ items: [result({ trackId: 'esistente' })] });
    render(SearchView);
    await userEvent.type(screen.getByRole('searchbox'), 'nirvana{Enter}');
    expect(await screen.findByRole('button', { name: 'Riproduci Come As You Are' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aggiungi/ })).toBeNull();
  });

  test('offline: ricerca remota non disponibile e avviso "Sei offline"', async () => {
    s.connection.set({ online: false });
    render(OfflineBanner);
    render(SearchView);
    await userEvent.type(screen.getByRole('searchbox'), 'nirvana{Enter}');
    expect(screen.getByTestId('offline-banner')).toHaveTextContent('Sei offline');
    expect(screen.getByTestId('remote-unavailable')).toBeInTheDocument();
    expect(s.fake.remote.search).not.toHaveBeenCalled();
  });
});

describe('Playlist', () => {
  function playlist(): PlaylistDto {
    const tracks = [makeTrack({ title: 'A' }), makeTrack({ title: 'B' }), makeTrack({ title: 'C' })];
    return {
      id: 'p1',
      name: 'Notte',
      trackCount: 3,
      durationMs: 540_000,
      coverTrackIds: tracks.map((t) => t.id),
      createdAt: 1,
      updatedAt: 1,
      items: tracks.map((track, i) => ({ itemId: `i${i}`, addedAt: 1, track })),
    };
  }
  const titles = () =>
    screen.getAllByTestId('track-row').map((r) => within(r).getByText(/^[ABC]$/).textContent);

  test('riordino con la maniglia (tastiera) salvato sul server', async () => {
    const p = playlist();
    s.fake.playlists.get.mockResolvedValue(p);
    const moved = { ...p, items: [p.items[1]!, p.items[0]!, p.items[2]!] };
    s.fake.playlists.moveItem.mockResolvedValue(moved);
    render(PlaylistView, { id: 'p1' });
    await screen.findByText('A');
    expect(titles()).toEqual(['A', 'B', 'C']);
    const handle = screen.getByRole('button', { name: /Sposta B/ });
    await fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(titles()).toEqual(['B', 'A', 'C']); // aggiornamento ottimistico
    expect(s.fake.playlists.moveItem).toHaveBeenCalledWith('p1', 'i1', 0);
  });

  test('riordino con trascinamento', async () => {
    const p = playlist();
    s.fake.playlists.get.mockResolvedValue(p);
    s.fake.playlists.moveItem.mockResolvedValue({ ...p, items: [p.items[1]!, p.items[2]!, p.items[0]!] });
    render(PlaylistView, { id: 'p1' });
    await screen.findByText('A');
    const handle = screen.getByRole('button', { name: /Sposta A/ });
    await fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    const list = handle.closest('.tracks')!;
    await fireEvent.pointerMove(list, { clientY: 100 + 64 * 2, pointerId: 1 });
    await fireEvent.pointerUp(list, { clientY: 100 + 64 * 2, pointerId: 1 });
    expect(s.fake.playlists.moveItem).toHaveBeenCalledWith('p1', 'i0', 2);
  });

  test('rinomina', async () => {
    s.fake.playlists.get.mockResolvedValue(playlist());
    s.fake.playlists.rename.mockResolvedValue({ ...playlist(), name: 'Giorno' });
    render(PlaylistView, { id: 'p1' });
    render(Dialogs);
    await screen.findByRole('heading', { name: 'Notte' });
    await userEvent.click(screen.getByRole('button', { name: 'Rinomina playlist' }));
    const input = screen.getByLabelText('Nome');
    await userEvent.clear(input);
    await userEvent.type(input, 'Giorno{Enter}');
    expect(s.fake.playlists.rename).toHaveBeenCalledWith('p1', 'Giorno');
    expect(await screen.findByRole('heading', { name: 'Giorno' })).toBeInTheDocument();
  });

  test('nome vuoto rifiutato prima di chiamare il server', async () => {
    s.fake.playlists.get.mockResolvedValue(playlist());
    render(PlaylistView, { id: 'p1' });
    render(Dialogs);
    await screen.findByRole('heading', { name: 'Notte' });
    await userEvent.click(screen.getByRole('button', { name: 'Rinomina playlist' }));
    await userEvent.clear(screen.getByLabelText('Nome'));
    await userEvent.type(screen.getByLabelText('Nome'), '   {Enter}');
    expect(await screen.findByText('Il nome non può essere vuoto')).toBeInTheDocument();
    expect(s.fake.playlists.rename).not.toHaveBeenCalled();
  });

  test('offline: brani non scaricati attenuati e non selezionabili', async () => {
    const p = playlist();
    s.fake.playlists.get.mockResolvedValue(p);
    render(PlaylistView, { id: 'p1' });
    await screen.findByText('A');
    s.downloads.entries = { [p.items[0]!.track.id]: { status: 'downloaded', progress: 1 } };
    s.connection.set({ online: false });
    await flush();
    expect(screen.getByRole('button', { name: /Riproduci A di/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Riproduci B di/ })).toBeDisabled();
  });
});

describe('menu del brano', () => {
  async function open(o: { playlistId?: string; itemId?: string } = {}) {
    const track = makeTrack({ title: 'Song' });
    render(TrackMenu);
    render(Dialogs);
    s.ui.menu = { track, ...o };
    await flush();
    return track;
  }
  const action = (id: string) => document.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;

  test('aggiungi ai preferiti', async () => {
    const t = await open();
    await userEvent.click(action('favorite'));
    expect(s.fake.favorites.add).toHaveBeenCalledWith(t.id);
    expect(s.ui.menu).toBeNull();
  });

  test('riproduci dopo', async () => {
    const t = await open();
    await userEvent.click(action('play-next'));
    expect(s.player.queue?.items).toContain(t.id);
  });

  test('aggiungi a playlist', async () => {
    s.fake.playlists.list.mockResolvedValue({
      items: [
        {
          id: 'p1',
          name: 'Notte',
          trackCount: 0,
          durationMs: 0,
          coverTrackIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    s.fake.playlists.addItem.mockResolvedValue({});
    const t = await open();
    await userEvent.click(action('add-to-playlist'));
    await userEvent.click(await screen.findByRole('button', { name: /Notte/ }));
    expect(s.fake.playlists.addItem).toHaveBeenCalledWith('p1', t.id);
  });

  test('scarica', async () => {
    const download = vi.spyOn(s.downloads, 'download').mockResolvedValue();
    const t = await open();
    await userEvent.click(action('download'));
    expect(download).toHaveBeenCalledWith(t);
  });

  test('rimuovi da questa playlist (solo dal contesto playlist)', async () => {
    await open();
    expect(action('remove-from-playlist')).toBeNull();
    s.ui.menu = null;
    await flush();
    s.fake.playlists.get.mockResolvedValue({ id: 'p1', items: [] });
    await open({ playlistId: 'p1', itemId: 'i9' });
    await userEvent.click(action('remove-from-playlist'));
    expect(s.fake.playlists.removeItem).toHaveBeenCalledWith('p1', 'i9');
  });

  test('modifica informazioni', async () => {
    const t = await open();
    s.fake.tracks.update.mockResolvedValue({ ...t, title: 'Song (Live)' });
    await userEvent.click(action('edit'));
    const title = screen.getByLabelText('Titolo');
    await userEvent.clear(title);
    await userEvent.type(title, 'Song (Live)');
    await userEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(s.fake.tracks.update).toHaveBeenCalledWith(t.id, {
      title: 'Song (Live)',
      artist: 'Artista',
      album: null,
    });
  });

  test('elimina con conferma', async () => {
    const t = await open();
    await userEvent.click(action('delete'));
    expect(s.fake.tracks.delete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    expect(s.fake.tracks.delete).toHaveBeenCalledWith(t.id);
  });

  test('offline: azioni che richiedono il server disabilitate', async () => {
    s.connection.set({ online: false });
    await open();
    expect(action('favorite')).toBeDisabled();
    expect(action('delete')).toBeDisabled();
    expect(action('play-next')).toBeEnabled();
  });
});

describe('Impostazioni', () => {
  test('"Storage protetto" quando concesso', async () => {
    s.storage.persisted = true;
    render(SettingsView);
    expect(screen.getByTestId('storage-status')).toHaveTextContent('Storage protetto');
  });

  test('avviso quando non concesso', async () => {
    s.storage.persisted = false;
    render(SettingsView);
    expect(screen.getByTestId('storage-status')).toHaveTextContent('Storage non protetto');
  });

  test('logout', async () => {
    render(SettingsView);
    expect(screen.getByText('fede')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Esci/ }));
    await vi.waitFor(() => expect(s.session.status).toBe('anonymous'));
    expect(s.fake.auth.logout).toHaveBeenCalled();
    expect(s.router.route.name).toBe('login');
  });
});
