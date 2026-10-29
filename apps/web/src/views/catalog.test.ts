import type { AlbumDto, AlbumSummaryDto, GenreDetailDto, LookupCandidateDto } from '@spookyfy/shared';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import CatalogDialogs from '../components/CatalogDialogs.svelte';
import Dialogs from '../components/Dialogs.svelte';
import TrackMenu from '../components/TrackMenu.svelte';
import { ApiError } from '../lib/api';
import { matchRoute, pathOf } from '../lib/router.svelte';
import { type TestServices, flush, makeTrack, setupServices } from '../test/fixtures';
import AlbumView from './AlbumView.svelte';
import GenreView from './GenreView.svelte';
import LibraryView from './LibraryView.svelte';
import SearchView from './SearchView.svelte';
import SettingsView from './SettingsView.svelte';

let s: TestServices;
beforeEach(async () => {
  s = await setupServices();
});

function album(o: Partial<AlbumDto> = {}): AlbumDto {
  const tracks = o.tracks ?? [
    makeTrack({ title: 'A', albumId: 'a1', album: 'In Utero' }),
    makeTrack({ title: 'B', albumId: 'a1', album: 'In Utero' }),
    makeTrack({ title: 'C', albumId: 'a1', album: 'In Utero' }),
  ];
  return {
    id: 'a1',
    title: 'In Utero',
    artist: 'Nirvana',
    year: 1993,
    origin: 'auto',
    trackCount: tracks.length,
    durationMs: 540_000,
    coverUrl: '/api/albums/a1/cover?size=512&v=0',
    coverThumbUrl: '/api/albums/a1/cover?size=128&v=0',
    dominantColor: '#334455',
    hasCustomCover: false,
    addedAt: 1,
    updatedAt: 1,
    genres: ['Grunge'],
    tracks,
    ...o,
  };
}
const summary = (a: AlbumDto): AlbumSummaryDto => {
  const { genres: _g, tracks: _t, ...rest } = a;
  return rest;
};
const candidate: LookupCandidateDto = {
  id: 'mb:x',
  source: 'musicbrainz',
  title: 'In Utero',
  artist: 'Nirvana',
  year: 1993,
  genres: ['grunge'],
  coverUrl: 'https://coverartarchive.org/release-group/x/front-500',
  thumbUrl: 'https://coverartarchive.org/release-group/x/front-250',
  score: 100,
};
const titles = () =>
  screen.getAllByTestId('track-row').map((r) => within(r).getByText(/^[ABC]$/).textContent);

describe('rotte', () => {
  test('album e generi', () => {
    expect(matchRoute('/library/albums').name).toBe('albums');
    expect(matchRoute('/library/genres').name).toBe('genres');
    expect(matchRoute(pathOf.album('a 1'))).toMatchObject({ name: 'album', params: { id: 'a 1' } });
    expect(matchRoute(pathOf.genre('Hip-Hop/Rap'))).toMatchObject({
      name: 'genre',
      params: { name: 'Hip-Hop/Rap' },
    });
  });
});

describe('Libreria: Album e Generi', () => {
  test('filtri separati dalle playlist; griglia degli album con ordinamento', async () => {
    s.fake.albums.list.mockResolvedValue({ items: [summary(album())] });
    render(LibraryView, { view: 'albums' });
    expect(await screen.findByText('In Utero')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Album' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Playlist' })).not.toHaveAttribute('aria-current');
    expect(s.fake.playlists.list).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText('Ordina per'), 'artist');
    expect(s.fake.albums.list).toHaveBeenLastCalledWith('artist');
  });

  test('stati vuoti con spiegazione', async () => {
    render(LibraryView, { view: 'albums' });
    expect(await screen.findByText(/Nessun album\. I brani con l’album nei tag/)).toBeInTheDocument();
  });

  test('generi con il numero di brani', async () => {
    s.fake.genres.list.mockResolvedValue({ items: [{ name: 'Jazz', trackCount: 3 }] });
    render(LibraryView, { view: 'genres' });
    const link = await screen.findByRole('link', { name: /Jazz/ });
    expect(link).toHaveTextContent('3 brani');
    expect(link).toHaveAttribute('href', '/genre/Jazz');
  });

  test('nuovo album dalla vista Album', async () => {
    s.fake.albums.create.mockResolvedValue(album({ id: 'a9', title: 'Demo', tracks: [] }));
    render(LibraryView, { view: 'albums' });
    render(Dialogs);
    await userEvent.click(screen.getByRole('button', { name: 'Nuovo album' }));
    await userEvent.type(screen.getByLabelText('Titolo dell’album'), 'Demo');
    await userEvent.click(screen.getByRole('button', { name: 'Crea' }));
    expect(s.fake.albums.create).toHaveBeenCalledWith({ title: 'Demo' });
    expect(s.router.route.path).toBe('/album/a9');
  });
});

describe('pagina dell’album', () => {
  test('brani nell’ordine dell’album, anno, generi e riordino salvato', async () => {
    const a = album();
    s.fake.albums.get.mockResolvedValue(a);
    s.fake.albums.moveTrack.mockResolvedValue({ ...a, tracks: [a.tracks[1]!, a.tracks[0]!, a.tracks[2]!] });
    render(AlbumView, { id: 'a1' });
    await screen.findByText('A');
    expect(titles()).toEqual(['A', 'B', 'C']);
    expect(screen.getByText(/Album · Nirvana · 1993/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Grunge' })).toHaveAttribute('href', '/genre/Grunge');
    await fireEvent.keyDown(screen.getByRole('button', { name: /Sposta B/ }), { key: 'ArrowUp' });
    expect(titles()).toEqual(['B', 'A', 'C']);
    expect(s.fake.albums.moveTrack).toHaveBeenCalledWith('a1', a.tracks[1]!.id, 0);
  });

  test('riproduzione dal primo brano', async () => {
    const a = album();
    s.fake.albums.get.mockResolvedValue(a);
    render(AlbumView, { id: 'a1' });
    await screen.findByText('A');
    await userEvent.click(screen.getByRole('button', { name: 'Riproduci In Utero' }));
    expect(s.player.current?.id).toBe(a.tracks[0]!.id);
  });

  test('eliminazione con conferma: i brani restano', async () => {
    s.fake.albums.get.mockResolvedValue(album());
    render(AlbumView, { id: 'a1' });
    render(Dialogs);
    await screen.findByText('A');
    await userEvent.click(screen.getByRole('button', { name: 'Elimina album' }));
    expect(screen.getByText(/I brani restano nella libreria/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    expect(s.fake.albums.delete).toHaveBeenCalledWith('a1');
    expect(s.router.route.path).toBe('/library/albums');
  });

  test('album inesistente', async () => {
    s.fake.albums.get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Album non trovato'));
    render(AlbumView, { id: 'zz' });
    expect(await screen.findByText('Album non trovato.')).toBeInTheDocument();
  });
});

describe('pagina del genere', () => {
  test('brani e album del genere; casuale solo fra i brani del genere', async () => {
    const tracks = [makeTrack({ title: 'So What' }), makeTrack({ title: 'Blue in Green' })];
    const g: GenreDetailDto = {
      name: 'Jazz',
      trackCount: 2,
      tracks,
      albums: [summary(album({ title: 'Kind of Blue' }))],
    };
    s.fake.genres.get.mockResolvedValue(g);
    render(GenreView, { name: 'jazz' });
    expect(await screen.findByText('So What')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Kind of Blue/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riproduci in ordine casuale' }));
    expect(s.player.shuffle).toBe(true);
    expect([...(s.player.queue?.items ?? [])].sort()).toEqual(tracks.map((t) => t.id).sort());
  });
});

describe('copertina dell’album', () => {
  async function openCover(a = album()) {
    render(CatalogDialogs);
    s.ui.albumCover = a;
    await flush();
    return a;
  }

  test('solo copertina: il candidato si applica senza cambiare gli altri campi', async () => {
    s.fake.lookup.search.mockResolvedValue({ items: [candidate] });
    s.fake.albums.applyCandidate.mockResolvedValue(album({ hasCustomCover: true }));
    await openCover();
    await userEvent.click(await screen.findByRole('button', { name: 'Cerca online' }));
    expect(s.fake.lookup.search).toHaveBeenCalledWith({ album: 'In Utero', artist: 'Nirvana' });
    const option = await screen.findByRole('button', { name: /In Utero di Nirvana, 1993 \(MusicBrainz\)/ });
    expect(option.querySelector('img')).toHaveAttribute(
      'src',
      `/api/lookup/image?url=${encodeURIComponent(candidate.thumbUrl)}`,
    );
    await userEvent.click(option);
    await userEvent.click(screen.getByRole('button', { name: 'Applica' }));
    expect(s.fake.albums.applyCandidate).toHaveBeenCalledWith('a1', {
      candidate,
      fields: { title: false, artist: false, year: false, genres: false },
    });
    expect(s.ui.albumCover).toBeNull();
  });

  test('senza connessione: messaggio e copertina invariata', async () => {
    s.fake.lookup.search.mockRejectedValue(new ApiError(0, 'NETWORK', 'offline'));
    await openCover();
    await userEvent.click(await screen.findByRole('button', { name: 'Cerca online' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La ricerca online richiede la connessione');
    expect(s.fake.albums.applyCandidate).not.toHaveBeenCalled();
  });

  test('file non valido: rifiutato prima di inviarlo', async () => {
    await openCover();
    const input = screen.getByLabelText('Immagine della copertina') as HTMLInputElement;
    await fireEvent.change(input, {
      target: { files: [new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Formato non supportato');
    expect(s.fake.albums.setCover).not.toHaveBeenCalled();
  });

  test('immagine dal dispositivo', async () => {
    s.fake.albums.setCover.mockResolvedValue(album({ hasCustomCover: true }));
    await openCover();
    const png = new File([new Uint8Array(8)], 'foto.png', { type: 'image/png' });
    await fireEvent.change(screen.getByLabelText('Immagine della copertina'), { target: { files: [png] } });
    await vi.waitFor(() => expect(s.fake.albums.setCover).toHaveBeenCalledWith('a1', png));
  });

  test('ricerca spenta: niente "Cerca online"', async () => {
    s.fake.settings.get.mockResolvedValue({ coverLookup: false, coverLookupLocked: false });
    await openCover();
    await flush();
    expect(screen.queryByRole('button', { name: 'Cerca online' })).toBeNull();
    expect(screen.getByRole('button', { name: /Scegli dal dispositivo/ })).toBeInTheDocument();
  });
});

describe('modifica dell’album', () => {
  test('titolo, anno e generi per tutti i brani', async () => {
    const a = album();
    s.fake.albums.update.mockResolvedValue({ ...a, title: 'In Utero (2013)' });
    s.fake.albums.updateGenres.mockResolvedValue(a);
    render(CatalogDialogs);
    s.ui.editAlbum = a;
    await flush();
    const title = screen.getByLabelText('Titolo');
    await userEvent.clear(title);
    await userEvent.type(title, 'In Utero (2013)');
    await userEvent.type(screen.getByLabelText('Generi di tutti i brani'), 'Rock{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Togli Grunge' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(s.fake.albums.update).toHaveBeenCalledWith('a1', {
      title: 'In Utero (2013)',
      artist: 'Nirvana',
      year: 1993,
    });
    expect(s.fake.albums.updateGenres).toHaveBeenCalledWith('a1', { add: ['Rock'], remove: ['Grunge'] });
  });

  test('anno non valido: errore senza chiamare il server', async () => {
    render(CatalogDialogs);
    s.ui.editAlbum = album();
    await flush();
    const year = screen.getByLabelText('Anno (facoltativo)');
    await userEvent.clear(year);
    await userEvent.type(year, '999');
    await userEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/fra 1000 e 2100/);
    expect(s.fake.albums.update).not.toHaveBeenCalled();
  });
});

describe('menu del brano: album e generi', () => {
  async function open(track = makeTrack({ title: 'Song' })) {
    render(TrackMenu);
    render(Dialogs);
    render(CatalogDialogs);
    s.ui.menu = { track };
    await flush();
    return track;
  }
  const action = (id: string) => document.querySelector<HTMLButtonElement>(`[data-action="${id}"]`);

  test('aggiungi ad album con ricerca nel selettore', async () => {
    s.fake.albums.list.mockResolvedValue({
      items: [summary(album()), summary(album({ id: 'a2', title: 'Nevermind' }))],
    });
    s.fake.albums.addTracks.mockResolvedValue(album({ id: 'a2', title: 'Nevermind' }));
    const t = await open();
    await userEvent.click(action('add-to-album')!);
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Cerca un album' }), 'never');
    expect(screen.queryByRole('button', { name: /In Utero/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Nevermind/ }));
    expect(s.fake.albums.addTracks).toHaveBeenCalledWith('a2', [t.id]);
  });

  test('brano in un album: vai all’album e togli dall’album', async () => {
    s.fake.albums.removeTrack.mockResolvedValue(undefined);
    s.fake.tracks.get.mockImplementation(async (id: string) => makeTrack({ id }));
    const t = await open(makeTrack({ title: 'Song', albumId: 'a1', album: 'In Utero' }));
    expect(action('lookup')).toBeNull();
    await userEvent.click(action('go-to-album')!);
    expect(s.router.route.path).toBe('/album/a1');
    s.ui.menu = { track: t };
    await flush();
    await userEvent.click(action('remove-from-album')!);
    expect(s.fake.albums.removeTrack).toHaveBeenCalledWith('a1', t.id);
  });

  test('generi dalla finestra "Modifica informazioni"', async () => {
    s.fake.genres.list.mockResolvedValue({ items: [{ name: 'Elettronica', trackCount: 4 }] });
    const t = await open();
    s.fake.tracks.update.mockResolvedValue(t);
    s.fake.genres.setForTrack.mockResolvedValue({ ...t, genres: ['Elettronica'] });
    await userEvent.click(action('genres')!);
    await userEvent.type(screen.getByLabelText('Generi'), 'ele');
    await userEvent.click(await screen.findByRole('button', { name: '+ Elettronica' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(s.fake.genres.setForTrack).toHaveBeenCalledWith(t.id, ['Elettronica']);
  });

  test('brano senza album: "Cerca album online" propone gli album che lo contengono', async () => {
    s.fake.lookup.search.mockResolvedValue({ items: [candidate] });
    const t = await open();
    await userEvent.click(action('lookup')!);
    expect(s.fake.lookup.search).toHaveBeenCalledWith({ title: t.title, artist: t.artist });
    expect(await screen.findByRole('button', { name: /In Utero di Nirvana/ })).toBeInTheDocument();
  });

  test('ricerca online spenta: nessuna voce "Cerca album online"', async () => {
    s.fake.settings.get.mockResolvedValue({ coverLookup: false, coverLookupLocked: false });
    await open();
    await vi.waitFor(() => expect(s.catalog.settings?.coverLookup).toBe(false));
    expect(action('lookup')).toBeNull();
  });
});

describe('Cerca e Impostazioni', () => {
  test('gli album compaiono fra i risultati locali', async () => {
    s.fake.albums.list.mockResolvedValue({ items: [summary(album({ title: 'Nevermind' }))] });
    render(SearchView);
    await userEvent.type(screen.getByRole('searchbox'), 'nevermi');
    expect(await screen.findByRole('link', { name: /Nevermind/ })).toHaveAttribute('href', '/album/a1');
    expect(s.fake.albums.list).toHaveBeenCalledWith('title', 'nevermi');
  });

  test('interruttore "Cerca copertine online" con la spiegazione dei dati inviati', async () => {
    s.fake.settings.update.mockResolvedValue({ coverLookup: false, coverLookupLocked: false });
    render(SettingsView);
    const toggle = await screen.findByRole('switch', { name: 'Cerca copertine online' });
    await vi.waitFor(() => expect(toggle).toBeChecked());
    expect(screen.getByText(/inviando titolo, artista e album/)).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(s.fake.settings.update).toHaveBeenCalledWith({ coverLookup: false });
  });

  test('ricerca forzata spenta dal server: interruttore bloccato', async () => {
    s.fake.settings.get.mockResolvedValue({ coverLookup: false, coverLookupLocked: true });
    render(SettingsView);
    const toggle = await screen.findByRole('switch', { name: 'Cerca copertine online' });
    await vi.waitFor(() => expect(toggle).toBeDisabled());
    expect(screen.getByText(/COVER_LOOKUP=off/)).toBeInTheDocument();
  });
});

describe('store del catalogo', () => {
  test('una copertina assegnata arriva ai brani in coda nel player', async () => {
    const a = album();
    s.player.playTracks(a.tracks, 0);
    const withCover = album({
      hasCustomCover: true,
      tracks: a.tracks.map((t) => ({ ...t, coverUrl: '/api/albums/a1/cover?size=512&v=1' })),
    });
    s.fake.albums.setCover.mockResolvedValue(withCover);
    await s.catalog.setCover('a1', new Blob([new Uint8Array(4)], { type: 'image/png' }));
    expect(s.player.current?.coverUrl).toBe('/api/albums/a1/cover?size=512&v=1');
    expect(s.catalog.details.a1?.hasCustomCover).toBe(true);
  });

  test('riordino non salvato: l’album viene ricaricato', async () => {
    const a = album();
    s.fake.albums.get.mockResolvedValue(a);
    await s.catalog.loadAlbum('a1');
    s.fake.albums.moveTrack.mockRejectedValue(new ApiError(500, 'INTERNAL', 'no'));
    await expect(s.catalog.moveTrack('a1', a.tracks[2]!.id, 0)).rejects.toBeInstanceOf(ApiError);
    expect(s.catalog.details.a1?.tracks.map((t) => t.title)).toEqual(['A', 'B', 'C']);
  });
});

test('copertine trovate in background: l’album aperto si aggiorna', async () => {
  s.fake.albums.get.mockResolvedValueOnce(album()).mockResolvedValueOnce(album({ hasCustomCover: true }));
  s.fake.albums.list.mockResolvedValue({ items: [summary(album({ hasCustomCover: true }))] });
  await s.catalog.loadAlbum('a1');
  await s.catalog.loadAlbums();
  await s.catalog.refresh();
  expect(s.catalog.details.a1?.hasCustomCover).toBe(true);
  expect(s.catalog.albums?.[0]?.hasCustomCover).toBe(true);
});
