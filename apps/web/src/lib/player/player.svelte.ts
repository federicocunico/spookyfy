import type { TrackDto } from '@spookyfy/shared';
import type { Downloads } from '../offline/downloads.svelte';
import type { Connection } from '../stores/connection.svelte';
import type { Toasts } from '../stores/toasts.svelte';
import type { MediaSessionBridge } from './media-session';
import type { PlayReporter } from './play-reporter';
import { PlayTracker } from './play-tracker';
import {
  type QueueState,
  type RepeatMode,
  createQueue,
  currentId,
  cycleRepeat,
  jumpTo,
  next,
  playNext,
  previous,
  removeTrack,
  setShuffle,
  upcoming,
} from './queue';

export const PLAYER_STORAGE_KEY = 'spk-player';
const PERSIST_INTERVAL_MS = 5000;

// Auto-trim (vedi @spookyfy/shared, silence.ts): il silenzio ai bordi si salta, il file resta intero.
/** Secondi da cui parte la riproduzione. */
const trimStart = (t: TrackDto) => (t.trimStartMs ?? 0) / 1000;
/** Secondi in cui la riproduzione finisce, se prima della fine del file. */
const trimEnd = (t: TrackDto) => (t.trimEndMs ? t.trimEndMs / 1000 : null);
/** Durata mostrata: fino al punto di fine (la barra parte comunque da 0:00). */
const playableDuration = (t: TrackDto) => (t.trimEndMs ?? t.durationMs) / 1000;

interface Persisted {
  queue: QueueState;
  tracks: Record<string, TrackDto>;
  position: number;
}

export interface PlayerDeps {
  downloads: Pick<Downloads, 'isDownloaded'>;
  connection: Pick<Connection, 'offline'>;
  toasts: Pick<Toasts, 'show' | 'error'>;
  reporter: Pick<PlayReporter, 'record'>;
  mediaSession: MediaSessionBridge;
  storage?: Storage;
  /**
   * Sorgente alternativa per un URL che senza Service Worker non funzionerebbe (modalità
   * client dopo una ricarica forzata): null = si usa l'URL così com'è.
   */
  resolveSrc?: (url: string) => Promise<string | null> | null;
}

/**
 * Motore di riproduzione: un solo elemento <audio>, montato una volta nel layout
 * radice; cambiando brano cambia solo `src` (necessario su iOS per il passaggio
 * automatico in background e per la lockscreen).
 */
export class Player {
  queue = $state<QueueState | null>(null);
  tracks = $state<Record<string, TrackDto>>({});
  playing = $state(false);
  buffering = $state(false);
  /** Secondi. */
  position = $state(0);
  duration = $state(0);

  current = $derived.by(() => {
    const id = this.queue ? currentId(this.queue) : undefined;
    return id ? (this.tracks[id] ?? null) : null;
  });
  shuffle = $derived(this.queue?.shuffle ?? false);
  repeat = $derived<RepeatMode>(this.queue?.repeat ?? 'off');
  upcomingTracks = $derived(
    this.queue ? upcoming(this.queue).flatMap((id) => (this.tracks[id] ? [this.tracks[id]!] : [])) : [],
  );

  private audio: HTMLAudioElement | null = null;
  private readonly tracker: PlayTracker;
  /** Brano ripristinato all'avvio ma non ancora caricato nell'elemento audio. */
  private needsLoad = false;
  private pendingSeek: number | null = null;
  private lastPersist = 0;
  private readonly storage: Storage | undefined;

  constructor(private readonly deps: PlayerDeps) {
    this.storage = deps.storage ?? globalThis.localStorage;
    this.tracker = new PlayTracker((trackId) => void deps.reporter.record(trackId).catch(() => {}));
  }

  // ---------- collegamento all'elemento audio ----------

  attach(audio: HTMLAudioElement): void {
    this.audio = audio;
    audio.preload = 'auto';
    audio.addEventListener('play', this.onPlay);
    audio.addEventListener('playing', this.onPlaying);
    audio.addEventListener('pause', this.onPause);
    audio.addEventListener('timeupdate', this.onTimeUpdate);
    audio.addEventListener('loadedmetadata', this.onLoadedMetadata);
    audio.addEventListener('durationchange', this.onLoadedMetadata);
    audio.addEventListener('seeked', this.onSeeked);
    audio.addEventListener('waiting', this.onWaiting);
    audio.addEventListener('ended', this.onEnded);
    audio.addEventListener('error', this.onError);
    this.deps.mediaSession.setHandlers({
      play: () => this.resume(),
      pause: () => this.pause(),
      previous: () => this.previous(),
      next: () => this.next(),
      seekTo: (s) => this.seek(s),
    });
  }

  detach(): void {
    const a = this.audio;
    if (!a) return;
    for (const [type, fn] of [
      ['play', this.onPlay],
      ['playing', this.onPlaying],
      ['pause', this.onPause],
      ['timeupdate', this.onTimeUpdate],
      ['loadedmetadata', this.onLoadedMetadata],
      ['durationchange', this.onLoadedMetadata],
      ['seeked', this.onSeeked],
      ['waiting', this.onWaiting],
      ['ended', this.onEnded],
      ['error', this.onError],
    ] as const) {
      a.removeEventListener(type, fn as EventListener);
    }
    this.audio = null;
  }

  // ---------- comandi (dai gesti dell'utente: play() resta sincrono) ----------

  /** Avvia la riproduzione di una lista dal brano toccato; la coda è il resto della lista. */
  playTracks(tracks: TrackDto[], startIndex = 0, context: string | null = null): void {
    if (tracks.length === 0) return;
    this.tracks = Object.fromEntries(tracks.map((t) => [t.id, t]));
    this.queue = createQueue(
      tracks.map((t) => t.id),
      startIndex,
      { shuffle: this.queue?.shuffle ?? false, repeat: this.queue?.repeat ?? 'off', context },
    );
    // Con lo shuffle attivo si parte comunque dal brano toccato.
    this.loadCurrent({ autoplay: true });
  }

  toggle(): void {
    if (!this.audio || !this.current) return;
    if (this.audio.paused) this.resume();
    else this.pause();
  }

  resume(): void {
    if (!this.audio || !this.current) return;
    if (this.needsLoad) {
      this.loadCurrent({ autoplay: true, startAt: this.position });
      return;
    }
    void this.audio.play().catch(() => {
      this.playing = false;
    });
  }

  pause(): void {
    this.audio?.pause();
  }

  next(): void {
    if (!this.queue) return;
    const step = next(this.queue);
    if (!step.play) return;
    this.queue = step.queue;
    this.loadCurrent({ autoplay: true });
  }

  previous(): void {
    if (!this.queue || !this.audio) return;
    // «Precedente» guarda quanto si è ascoltato dall'inizio della musica, non del file.
    const start = this.current ? trimStart(this.current) : 0;
    const step = previous(this.queue, (this.needsLoad ? this.position : this.audio.currentTime) - start);
    if (step.restart) {
      this.seek(start);
      if (this.audio.paused) this.resume();
      return;
    }
    this.queue = step.queue;
    this.loadCurrent({ autoplay: true });
  }

  seek(seconds: number): void {
    const target = Math.max(0, Math.min(seconds, this.duration || seconds));
    this.position = target;
    this.tracker.resync();
    if (!this.audio || this.needsLoad) return;
    this.audio.currentTime = target;
    this.deps.mediaSession.setPosition(this.duration, target);
    this.persist(true);
  }

  playNext(track: TrackDto): void {
    this.tracks = { ...this.tracks, [track.id]: track };
    if (!this.queue) {
      this.queue = createQueue([track.id], 0);
      this.needsLoad = true;
      this.position = 0;
      this.duration = playableDuration(track);
    } else {
      this.queue = playNext(this.queue, track.id);
    }
    this.persist(true);
    this.deps.toasts.show(`«${track.title}» verrà riprodotto dopo`);
  }

  jumpTo(position: number): void {
    if (!this.queue) return;
    this.queue = jumpTo(this.queue, position);
    this.loadCurrent({ autoplay: true });
  }

  toggleShuffle(): void {
    if (!this.queue) return;
    this.queue = setShuffle(this.queue, !this.queue.shuffle);
    this.persist(true);
  }

  cycleRepeat(): void {
    if (!this.queue) return;
    this.queue = { ...this.queue, repeat: cycleRepeat(this.queue.repeat) };
    this.persist(true);
  }

  /**
   * Sostituisce un brano provvisorio (in importazione, riprodotto in streaming)
   * con quello definitivo sul dispositivo. Se è in riproduzione non si interrompe:
   * l'audio continua dalla sorgente attuale, le riproduzioni successive usano la copia locale.
   */
  replaceTrack(oldId: string, track: TrackDto): void {
    if (!this.queue || !this.tracks[oldId]) return;
    const { [oldId]: _old, ...rest } = this.tracks;
    this.tracks = { ...rest, [track.id]: track };
    this.queue = { ...this.queue, items: this.queue.items.map((id) => (id === oldId ? track.id : id)) };
    if (this.current?.id === track.id) this.deps.mediaSession.setTrack(track);
    this.persist(true);
  }

  /** Metadati aggiornati (preferito, titolo corretto…). */
  updateTrack(track: TrackDto): void {
    if (!this.tracks[track.id]) return;
    this.tracks = { ...this.tracks, [track.id]: track };
    if (this.current?.id === track.id) this.deps.mediaSession.setTrack(track);
  }

  removeTrack(trackId: string): void {
    if (!this.queue) return;
    const wasCurrent = this.current?.id === trackId;
    const q = removeTrack(this.queue, trackId);
    if (q.items.length === 0) {
      this.stop();
      return;
    }
    this.queue = q;
    if (wasCurrent) this.loadCurrent({ autoplay: this.playing });
  }

  stop(): void {
    this.audio?.pause();
    if (this.audio) this.audio.removeAttribute('src');
    this.queue = null;
    this.tracks = {};
    this.position = 0;
    this.duration = 0;
    this.deps.mediaSession.setTrack(null);
    this.storage?.removeItem(PLAYER_STORAGE_KEY);
  }

  // ---------- ripristino all'avvio ----------

  /** Ripristina coda e posizione senza avviare l'audio: serve un tocco esplicito. */
  restore(): boolean {
    try {
      const raw = this.storage?.getItem(PLAYER_STORAGE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw) as Persisted;
      if (!saved.queue?.items?.length) return false;
      this.tracks = saved.tracks;
      this.queue = saved.queue;
      const cur = this.current;
      if (!cur) {
        this.queue = null;
        return false;
      }
      this.position = saved.position ?? 0;
      this.duration = playableDuration(cur);
      this.needsLoad = true;
      this.playing = false;
      return true;
    } catch {
      return false;
    }
  }

  private persist(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastPersist < PERSIST_INTERVAL_MS) return;
    this.lastPersist = now;
    if (!this.queue) return;
    const ids = new Set(this.queue.items);
    const data: Persisted = {
      queue: $state.snapshot(this.queue) as QueueState,
      tracks: Object.fromEntries(
        Object.entries($state.snapshot(this.tracks)).filter(([id]) => ids.has(id)),
      ) as Record<string, TrackDto>,
      position: this.position,
    };
    try {
      this.storage?.setItem(PLAYER_STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }

  /** Salvataggio immediato (es. su `pagehide`). */
  flush(): void {
    this.persist(true);
  }

  // ---------- interni ----------

  private loadCurrent({ autoplay, startAt = 0 }: { autoplay: boolean; startAt?: number }): void {
    const track = this.current;
    const audio = this.audio;
    if (!track || !audio) return;
    // Offline si suonano solo i brani scaricati (verifica sincrona: play() deve restare nel gesto).
    if (this.deps.connection.offline && !this.deps.downloads.isDownloaded(track.id)) {
      this.deps.toasts.show(`«${track.title}» non è disponibile offline`);
      this.skipToPlayable(autoplay);
      return;
    }
    this.needsLoad = false;
    const from = Math.max(startAt, trimStart(track));
    this.pendingSeek = from > 0 ? from : null;
    this.position = from;
    this.duration = playableDuration(track);
    this.deps.mediaSession.setTrack(track);
    this.tracker.start(track.id, track.durationMs);
    this.persist(true);
    const fallback = this.deps.resolveSrc?.(track.audioUrl) ?? null;
    if (!fallback) {
      // L'URL è sempre quello di rete: se il brano è scaricato lo serve il Service Worker dalla cache.
      this.setSrc(audio, track.audioUrl, autoplay);
      return;
    }
    void fallback.then((src) => {
      if (this.current?.id !== track.id) return;
      if (src) this.setSrc(audio, src, autoplay);
      else {
        this.deps.toasts.show(`«${track.title}» non è più sul dispositivo`);
        this.skipToPlayable(autoplay);
      }
    });
  }

  private objectUrl: string | null = null;

  private setSrc(audio: HTMLAudioElement, src: string, autoplay: boolean): void {
    if (this.objectUrl && this.objectUrl !== src) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = src.startsWith('blob:') ? src : null;
    audio.src = src;
    if (autoplay) {
      void audio.play().catch((err: unknown) => {
        if ((err as Error)?.name !== 'AbortError') this.playing = false;
      });
    }
  }

  /** Avanza al prossimo brano riproducibile offline, se c'è. */
  private skipToPlayable(autoplay: boolean): void {
    if (!this.queue) return;
    let q = this.queue;
    for (let i = 0; i < q.order.length; i++) {
      const step = next(q, { auto: false });
      if (!step.play) break;
      q = step.queue;
      const id = currentId(q);
      if (id && this.deps.downloads.isDownloaded(id)) {
        this.queue = q;
        this.loadCurrent({ autoplay });
        return;
      }
    }
    this.audio?.pause();
    this.playing = false;
    this.deps.toasts.show('Nessun brano scaricato nel resto della coda');
  }

  private onPlay = () => {
    this.playing = true;
    this.tracker.resync();
    this.deps.mediaSession.setPlaying(true);
  };

  private onPlaying = () => {
    this.buffering = false;
    this.deps.mediaSession.setPosition(this.duration, this.audio?.currentTime ?? 0);
  };

  private onPause = () => {
    this.playing = false;
    this.tracker.resync();
    this.deps.mediaSession.setPlaying(false);
    this.persist(true);
  };

  private onTimeUpdate = () => {
    const a = this.audio;
    if (!a || this.needsLoad) return;
    this.position = a.currentTime;
    if (!a.paused) this.tracker.tick(a.currentTime);
    // Silenzio finale: si passa al brano successivo come a fine file.
    const end = this.current ? trimEnd(this.current) : null;
    if (end !== null && !a.paused && a.currentTime >= end) {
      this.onEnded();
      return;
    }
    this.persist();
  };

  private onLoadedMetadata = () => {
    const a = this.audio;
    if (!a) return;
    const end = this.current ? trimEnd(this.current) : null;
    if (Number.isFinite(a.duration) && a.duration > 0)
      this.duration = Math.min(a.duration, end ?? a.duration);
    if (this.pendingSeek !== null) {
      a.currentTime = this.pendingSeek;
      this.pendingSeek = null;
    }
    this.deps.mediaSession.setPosition(this.duration, a.currentTime);
  };

  private onSeeked = () => {
    this.tracker.resync();
    this.deps.mediaSession.setPosition(this.duration, this.audio?.currentTime ?? 0);
  };

  private onWaiting = () => {
    this.buffering = true;
  };

  private onEnded = () => {
    if (!this.queue || !this.audio) return;
    const step = next(this.queue, { auto: true });
    if (!step.play) {
      // Fine della coda; con l'auto-trim l'audio sta ancora suonando il silenzio finale.
      this.audio.pause();
      this.playing = false;
      this.persist(true);
      return;
    }
    if (step.queue === this.queue) {
      // Ripeti brano: nuova riproduzione dello stesso elemento.
      const t = this.current!;
      this.tracker.start(t.id, t.durationMs);
      this.audio.currentTime = trimStart(t);
      void this.audio.play().catch(() => {});
      return;
    }
    this.queue = step.queue;
    this.loadCurrent({ autoplay: true });
  };

  private onError = () => {
    const track = this.current;
    if (!track || !this.audio?.getAttribute('src')) return;
    this.buffering = false;
    if (this.deps.connection.offline) {
      this.deps.toasts.show(`«${track.title}» non è disponibile offline`);
      this.skipToPlayable(true);
      return;
    }
    this.deps.toasts.error(`Impossibile riprodurre «${track.title}»`);
    this.playing = false;
  };
}
