import { WS_PATH, type WsServerEvent } from '@spookyfy/shared';

export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;

export interface RealtimeOptions {
  url?: string;
  onEvent(event: WsServerEvent): void;
  /** Dopo ogni riconnessione (non alla prima apertura): ricaricare lo stato perso. */
  onReconnect?(): void;
  WebSocketImpl?: typeof WebSocket;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

/** Canale in tempo reale con riconnessione a backoff esponenziale (1 s → 30 s). */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private everOpened = false;
  private timer: unknown = null;
  private stopped = true;
  connected = false;

  constructor(private readonly o: RealtimeOptions) {}

  private get url(): string {
    if (this.o.url) return this.o.url;
    const { protocol, host } = globalThis.location;
    return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}${WS_PATH}`;
  }

  /** Ritardo del tentativo n (0-based): 1, 2, 4, 8, 16, 30, 30… secondi. */
  static delay(attempt: number): number {
    return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  private open(): void {
    const Impl = this.o.WebSocketImpl ?? WebSocket;
    let ws: WebSocket;
    try {
      ws = new Impl(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.attempt = 0;
      if (this.everOpened) this.o.onReconnect?.();
      this.everOpened = true;
    };
    ws.onmessage = (e: MessageEvent) => {
      try {
        this.o.onEvent(JSON.parse(String(e.data)) as WsServerEvent);
      } catch {}
    };
    ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      if (!this.stopped) this.scheduleReconnect();
    };
    ws.onerror = () => {
      // Segue sempre "close": la riconnessione parte da lì.
    };
  }

  private scheduleReconnect(): void {
    const set = this.o.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    const delay = RealtimeClient.delay(this.attempt++);
    this.timer = set(() => {
      this.timer = null;
      if (!this.stopped) this.open();
    }, delay);
  }

  /** Riconnessione immediata (es. ritorno online o app di nuovo in primo piano). */
  nudge(): void {
    if (this.stopped || this.ws) return;
    if (this.timer !== null)
      (this.o.clearTimeout ?? ((id) => globalThis.clearTimeout(id as number)))(this.timer);
    this.timer = null;
    this.attempt = 0;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null)
      (this.o.clearTimeout ?? ((id) => globalThis.clearTimeout(id as number)))(this.timer);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.everOpened = false;
    this.attempt = 0;
  }
}
