import { type TestServices, flush, makeTrack, setupServices } from '../../test/fixtures';
import { ApiError } from '../api';
import { MediaSessionBridge } from './media-session';
import { PlayReporter } from './play-reporter';
import { PlayTracker } from './play-tracker';
import { PLAYER_STORAGE_KEY, Player } from './player.svelte';

let s: TestServices;
let audio: HTMLAudioElement;
beforeEach(async () => {
  s = await setupServices();
  audio = document.createElement('audio');
  s.player.attach(audio);
});
afterEach(() => s.player.detach());

const setTime = (t: number) => {
  Object.defineProperty(audio, 'currentTime', { value: t, writable: true, configurable: true });
  audio.dispatchEvent(new Event('timeupdate'));
};

describe('motore audio', () => {
  test('un solo elemento: cambiando brano cambia solo src', () => {
    const [a, b] = [makeTrack(), makeTrack()];
    const play = vi.spyOn(audio, 'play');
    s.player.playTracks([a, b], 0);
    expect(audio.getAttribute('src')).toBe(a.audioUrl);
    s.player.next();
    expect(audio.getAttribute('src')).toBe(b.audioUrl);
    expect(play).toHaveBeenCalledTimes(2);
    expect(s.player.playing).toBe(true);
  });

  test('il ripristino all’avvio non chiama play()', () => {
    const tracks = [makeTrack(), makeTrack()];
    s.player.playTracks(tracks, 1);
    setTime(42);
    s.player.flush();
    s.player.detach();

    const audio2 = document.createElement('audio');
    const play = vi.spyOn(audio2, 'play');
    const p2 = new Player({
      downloads: s.downloads,
      connection: s.connection,
      toasts: s.toasts,
      reporter: s.reporter,
      mediaSession: new MediaSessionBridge(undefined, undefined),
    });
    p2.attach(audio2);
    expect(p2.restore()).toBe(true);
    expect(play).not.toHaveBeenCalled();
    expect(audio2.getAttribute('src')).toBeNull();
    expect(p2.current?.id).toBe(tracks[1]!.id);
    expect(p2.position).toBe(42);
    expect(p2.playing).toBe(false);

    // Il primo tocco su Play carica il brano e riparte dalla posizione salvata.
    p2.toggle();
    expect(play).toHaveBeenCalledTimes(1);
    expect(audio2.getAttribute('src')).toBe(tracks[1]!.audioUrl);
    Object.defineProperty(audio2, 'duration', { value: 180, configurable: true });
    audio2.dispatchEvent(new Event('loadedmetadata'));
    expect(audio2.currentTime).toBe(42);
    p2.detach();
  });

  test('persistenza su pagehide: coda, brano e posizione', () => {
    const tracks = [makeTrack(), makeTrack(), makeTrack()];
    s.player.playTracks(tracks, 2, 'playlist:p1');
    setTime(17);
    s.player.flush();
    const saved = JSON.parse(localStorage.getItem(PLAYER_STORAGE_KEY)!);
    expect(saved.position).toBe(17);
    expect(saved.queue.items).toEqual(tracks.map((t) => t.id));
    expect(saved.queue.context).toBe('playlist:p1');
    expect(Object.keys(saved.tracks)).toHaveLength(3);
  });

  test('fine naturale: parte il successivo; ripeti brano riparte lo stesso', () => {
    const [a, b] = [makeTrack(), makeTrack()];
    s.player.playTracks([a, b], 0);
    audio.dispatchEvent(new Event('ended'));
    expect(s.player.current?.id).toBe(b.id);
    s.player.cycleRepeat(); // all
    s.player.cycleRepeat(); // one
    setTime(180);
    audio.dispatchEvent(new Event('ended'));
    expect(s.player.current?.id).toBe(b.id);
    expect(audio.currentTime).toBe(0);
  });

  test('"Precedente" oltre 3 secondi riparte, entro 3 torna indietro', () => {
    const [a, b] = [makeTrack(), makeTrack()];
    s.player.playTracks([a, b], 1);
    setTime(40);
    s.player.previous();
    expect(s.player.current?.id).toBe(b.id);
    expect(audio.currentTime).toBe(0);
    setTime(2);
    s.player.previous();
    expect(s.player.current?.id).toBe(a.id);
  });
});

describe('auto-trim del silenzio', () => {
  const playing = () => Object.defineProperty(audio, 'paused', { value: false, configurable: true });
  const loaded = (duration = 200) => {
    Object.defineProperty(audio, 'duration', { value: duration, configurable: true });
    audio.dispatchEvent(new Event('loadedmetadata'));
  };

  test('la riproduzione parte dopo il silenzio iniziale e la durata si ferma al punto di fine', () => {
    const t = makeTrack({ durationMs: 200_000, trimStartMs: 7000, trimEndMs: 170_000 });
    s.player.playTracks([t], 0);
    expect(s.player.position).toBe(7);
    expect(s.player.duration).toBe(170);
    loaded();
    expect(audio.currentTime).toBe(7);
    expect(s.player.duration).toBe(170);
  });

  test('al silenzio finale si passa al brano successivo', () => {
    const [a, b] = [makeTrack({ trimEndMs: 170_000 }), makeTrack()];
    s.player.playTracks([a, b], 0);
    playing();
    setTime(169.5);
    expect(s.player.current?.id).toBe(a.id);
    setTime(170.1);
    expect(s.player.current?.id).toBe(b.id);
    expect(audio.getAttribute('src')).toBe(b.audioUrl);
  });

  test('ultimo brano della coda: al silenzio finale l’audio si ferma', () => {
    const t = makeTrack({ trimEndMs: 170_000 });
    const pause = vi.spyOn(audio, 'pause');
    s.player.playTracks([t], 0);
    playing();
    setTime(170.1);
    expect(pause).toHaveBeenCalled();
    expect(s.player.playing).toBe(false);
  });

  test('in pausa nel silenzio finale non si salta (es. dopo uno spostamento manuale)', () => {
    const [a, b] = [makeTrack({ trimEndMs: 170_000 }), makeTrack()];
    s.player.playTracks([a, b], 0);
    Object.defineProperty(audio, 'paused', { value: true, configurable: true });
    setTime(175);
    expect(s.player.current?.id).toBe(a.id);
  });

  test('ripeti brano riparte dopo il silenzio iniziale', () => {
    const t = makeTrack({ trimStartMs: 7000, trimEndMs: 170_000 });
    s.player.playTracks([t], 0);
    s.player.cycleRepeat(); // all
    s.player.cycleRepeat(); // one
    playing();
    setTime(170.2);
    expect(s.player.current?.id).toBe(t.id);
    expect(audio.currentTime).toBe(7);
  });

  test('"Precedente" conta i secondi dall’inizio della musica', () => {
    const [a, b] = [makeTrack(), makeTrack({ trimStartMs: 7000 })];
    s.player.playTracks([a, b], 1);
    setTime(9); // 2 s di musica: torna al brano prima
    s.player.previous();
    expect(s.player.current?.id).toBe(a.id);

    s.player.playTracks([a, b], 1);
    setTime(40);
    s.player.previous(); // riparte dall'inizio della musica, non dal silenzio
    expect(s.player.current?.id).toBe(b.id);
    expect(audio.currentTime).toBe(7);
  });

  test('senza punti di trim il brano si riproduce intero', () => {
    const [a, b] = [makeTrack(), makeTrack()];
    s.player.playTracks([a, b], 0);
    playing();
    loaded(180);
    expect(audio.currentTime).toBe(0);
    setTime(179.9);
    expect(s.player.current?.id).toBe(a.id);
    expect(s.player.duration).toBe(180);
  });
});

describe('MediaSession', () => {
  test('metadati, posizione e comandi di sistema', async () => {
    const [a, b] = [makeTrack({ title: 'Uno', artist: 'X', album: 'Disco' }), makeTrack({ title: 'Due' })];
    s.player.playTracks([a, b], 0);
    expect(s.media.metadata).toMatchObject({ title: 'Uno', artist: 'X', album: 'Disco' });
    expect((s.media.metadata as MediaMetadataInit).artwork?.map((x) => x.sizes)).toEqual([
      '128x128',
      '512x512',
    ]);
    expect(s.media.playbackState).toBe('playing');

    Object.defineProperty(audio, 'duration', { value: 180, configurable: true });
    audio.dispatchEvent(new Event('loadedmetadata'));
    s.player.seek(120);
    expect(s.media.positions.at(-1)).toEqual({ duration: 180, position: 120, playbackRate: 1 });

    // Comandi dalla lockscreen / cuffie.
    s.media.handlers.nexttrack?.({ action: 'nexttrack' });
    expect(s.player.current?.id).toBe(b.id);
    expect(s.media.metadata).toMatchObject({ title: 'Due' });
    s.media.handlers.pause?.({ action: 'pause' });
    expect(s.media.playbackState).toBe('paused');
    s.media.handlers.seekto?.({ action: 'seekto', seekTime: 30 });
    expect(audio.currentTime).toBe(30);
    expect(s.media.handlers.seekforward).toBeNull();
  });
});

describe('conteggio degli ascolti', () => {
  test('soglia di 30 s di ascolto effettivo; i seek non contano', () => {
    const hits: string[] = [];
    const t = new PlayTracker((id) => hits.push(id));
    t.start('a', 180_000);
    for (let sec = 0; sec <= 20; sec += 0.25) t.tick(sec);
    t.tick(170); // seek in avanti: non conta
    expect(hits).toEqual([]);
    for (let sec = 170; sec <= 180; sec += 0.25) t.tick(sec);
    expect(hits).toEqual(['a']);
    for (let sec = 0; sec <= 60; sec += 0.25) t.tick(sec + 200);
    expect(hits).toEqual(['a']); // una sola volta per riproduzione
  });

  test('brani corti: metà durata', () => {
    const hits: string[] = [];
    const t = new PlayTracker((id) => hits.push(id));
    t.start('corto', 20_000);
    for (let sec = 0; sec <= 9.75; sec += 0.25) t.tick(sec);
    expect(hits).toEqual([]);
    t.tick(10);
    expect(hits).toEqual(['corto']);
  });

  test('salto dopo 10 s: nessun ascolto registrato', () => {
    const hits: string[] = [];
    const t = new PlayTracker((id) => hits.push(id));
    t.start('a', 180_000);
    for (let sec = 0; sec <= 10; sec += 0.25) t.tick(sec);
    expect(hits).toEqual([]);
  });

  test('il player segnala l’ascolto al reporter', () => {
    const record = vi.spyOn(s.reporter, 'record').mockResolvedValue({ id: 'x', trackId: 'x', playedAt: 1 });
    const a = makeTrack();
    s.player.playTracks([a], 0);
    for (let sec = 0; sec <= 31; sec += 0.5) setTime(sec);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(a.id);
  });

  test('offline l’ascolto resta in attesa e parte al ritorno online con l’orario originale', async () => {
    const reporter = new PlayReporter({
      api: s.fake,
      db: s.db,
      now: () => 1_000,
      uuid: () => '9f7c4b0a-1d2e-4f3a-8b5c-6d7e8f9a0b1c',
    });
    s.fake.plays.submit.mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'offline'));
    await reporter.record('a');
    await reporter.flush();
    expect(await reporter.pendingCount()).toBe(1);

    await reporter.flush();
    expect(s.fake.plays.submit).toHaveBeenLastCalledWith([
      { id: '9f7c4b0a-1d2e-4f3a-8b5c-6d7e8f9a0b1c', trackId: 'a', playedAt: 1_000 },
    ]);
    expect(await reporter.pendingCount()).toBe(0);
  });
});

describe('offline', () => {
  test('salta i brani non scaricati e avvisa', async () => {
    const [a, b, c] = [makeTrack(), makeTrack(), makeTrack()];
    s.downloads.entries = { [c.id]: { status: 'downloaded', progress: 1 } };
    s.connection.set({ online: false });
    const show = vi.spyOn(s.toasts, 'show');
    s.player.playTracks([a, b, c], 0);
    expect(s.player.current?.id).toBe(c.id);
    expect(audio.getAttribute('src')).toBe(c.audioUrl);
    expect(show).toHaveBeenCalledWith(expect.stringContaining('non è disponibile offline'));
  });

  test('nessun brano scaricato nel resto della coda: stop', () => {
    const [a, b] = [makeTrack(), makeTrack()];
    s.connection.set({ online: false });
    s.player.playTracks([a, b], 0);
    expect(audio.getAttribute('src')).toBeNull();
    expect(s.player.playing).toBe(false);
  });

  test('errore di caricamento offline (cache eliminata): passa al successivo scaricato', async () => {
    const [a, b] = [makeTrack(), makeTrack()];
    s.downloads.entries = {
      [a.id]: { status: 'downloaded', progress: 1 },
      [b.id]: { status: 'downloaded', progress: 1 },
    };
    s.player.playTracks([a, b], 0);
    s.connection.set({ online: false });
    audio.dispatchEvent(new Event('error'));
    await flush();
    expect(s.player.current?.id).toBe(b.id);
  });
});
