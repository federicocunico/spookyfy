export interface SdkState {
  paused: boolean;
  position: number;
  duration: number;
  disallows: Record<string, boolean>;
  track_window: {
    current_track: {
      uri: string;
      name: string;
      artists: { name: string }[];
      album: { name: string; images: { url: string }[] };
    };
  };
}
export interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, callback: (event: never) => void): boolean;
  removeListener(event: string): boolean;
  activateElement(): Promise<void>;
  getCurrentState(): Promise<SdkState | null>;
  pause(): Promise<void>;
}
export interface SdkNamespace {
  Player: new (options: {
    name: string;
    enableMediaSession: boolean;
    getOAuthToken(callback: (token: string) => void): void;
  }) => SdkPlayer;
}
type SdkWindow = Window & { Spotify?: SdkNamespace; onSpotifyWebPlaybackSDKReady?: () => void };
let loading: Promise<SdkNamespace> | undefined;

/** Import this module only following an explicit playback/browser-device gesture. */
export function loadSdk(win: SdkWindow = window, timeoutMs = 10000): Promise<SdkNamespace> {
  if (win.Spotify) return Promise.resolve(win.Spotify);
  if (loading) return loading;
  loading = new Promise<SdkNamespace>((resolve, reject) => {
    const script = win.document.createElement('script');
    const previous = win.onSpotifyWebPlaybackSDKReady;
    const cleanup = () => {
      clearTimeout(timer);
      script.onerror = null;
      win.onSpotifyWebPlaybackSDKReady = previous;
    };
    const fail = () => {
      cleanup();
      script.remove();
      reject(new Error('Player Spotify bloccato o browser incompatibile'));
    };
    const timer = setTimeout(fail, timeoutMs);
    win.onSpotifyWebPlaybackSDKReady = () => {
      previous?.();
      if (!win.Spotify) {
        fail();
        return;
      }
      cleanup();
      resolve(win.Spotify);
    };
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.onerror = fail;
    win.document.head.append(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
