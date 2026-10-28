import type { TrackDto } from '@spookyfy/shared';

export interface MediaSessionHandlers {
  play(): void;
  pause(): void;
  previous(): void;
  next(): void;
  seekTo(seconds: number): void;
}

const absolute = (url: string) => new URL(url, globalThis.location?.href ?? 'http://localhost').href;

/**
 * Integrazione con lockscreen, centro di controllo e cuffie. Niente
 * seekbackward/seekforward: così iOS mostra Precedente/Successivo.
 */
export class MediaSessionBridge {
  constructor(
    private readonly session: MediaSession | undefined = globalThis.navigator?.mediaSession,
    private readonly Metadata: typeof MediaMetadata | undefined = globalThis.MediaMetadata,
  ) {}

  get supported(): boolean {
    return Boolean(this.session && this.Metadata);
  }

  setHandlers(h: MediaSessionHandlers): void {
    if (!this.session) return;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        this.session!.setActionHandler(action, handler);
      } catch {}
    };
    set('play', () => h.play());
    set('pause', () => h.pause());
    set('previoustrack', () => h.previous());
    set('nexttrack', () => h.next());
    set('seekto', (d) => {
      if (typeof d.seekTime === 'number') h.seekTo(d.seekTime);
    });
    set('seekbackward', null);
    set('seekforward', null);
  }

  setTrack(track: TrackDto | null): void {
    if (!this.session || !this.Metadata) return;
    if (!track) {
      this.session.metadata = null;
      return;
    }
    this.session.metadata = new this.Metadata({
      title: track.title,
      artist: track.artist,
      album: track.album ?? '',
      artwork: [
        { src: absolute(track.coverThumbUrl), sizes: '128x128', type: 'image/jpeg' },
        { src: absolute(track.coverUrl), sizes: '512x512', type: 'image/jpeg' },
      ],
    });
  }

  setPlaying(playing: boolean): void {
    if (this.session) this.session.playbackState = playing ? 'playing' : 'paused';
  }

  setPosition(durationSec: number, positionSec: number, playbackRate = 1): void {
    if (!this.session?.setPositionState) return;
    if (!Number.isFinite(durationSec) || durationSec <= 0) return;
    try {
      this.session.setPositionState({
        duration: durationSec,
        position: Math.max(0, Math.min(positionSec, durationSec)),
        playbackRate,
      });
    } catch {}
  }
}
