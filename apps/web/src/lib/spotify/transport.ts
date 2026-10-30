import type { SpotifyErrorCode } from '@spookyfy/shared';

const messages: Record<SpotifyErrorCode | 'SESSION_REQUIRED', string> = {
  SPOTIFY_NOT_CONFIGURED: 'Spotify non è configurato su questa installazione.',
  SPOTIFY_POLICY_DISABLED: 'L’integrazione Spotify è in attesa di verifica dei requisiti della piattaforma.',
  SPOTIFY_REAUTH_REQUIRED: 'Ricollega Spotify dalle impostazioni per continuare.',
  SPOTIFY_PREMIUM_REQUIRED: 'La riproduzione Spotify richiede un abbonamento Premium valido.',
  SPOTIFY_SCOPE_REQUIRED: 'Autorizza questa funzione Spotify dalle impostazioni.',
  SPOTIFY_ACCESS_RESTRICTED: 'Spotify non consente questa operazione con l’accesso attuale.',
  SPOTIFY_RATE_LIMITED: 'Spotify ha ricevuto troppe richieste. Attendi prima di riprovare.',
  SPOTIFY_QUOTA_EXCEEDED: 'La quota Spotify dell’app è esaurita. Le funzioni locali restano disponibili.',
  SPOTIFY_DEVICE_UNAVAILABLE: 'Il dispositivo Spotify non è disponibile. Scegline un altro.',
  SPOTIFY_UNSUPPORTED: 'Questa operazione Spotify non è disponibile.',
  SPOTIFY_UNAVAILABLE: 'Spotify non è raggiungibile. Riprova più tardi.',
  SPOTIFY_CONTRACT_CHANGED: 'La risposta di Spotify è cambiata. Le funzioni locali restano disponibili.',
  SPOTIFY_MUTATION_UNCERTAIN: 'Spotify potrebbe aver applicato la modifica. Aggiorna prima di riprovare.',
  SESSION_REQUIRED: 'Accedi a Spookyfy per usare Spotify.',
};
export const spotifyErrorMessage = (code: SpotifyErrorCode | 'SESSION_REQUIRED'): string =>
  messages[code] ?? messages.SPOTIFY_UNAVAILABLE;

/** Provider errors never run the common API's connectivity/session hooks. */
export class SpotifyError extends Error {
  constructor(
    public readonly code: SpotifyErrorCode | 'SESSION_REQUIRED',
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'SpotifyError';
  }
}

export class SpotifyTransport {
  private lifetime = new AbortController();
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  reset(): void {
    this.lifetime.abort();
    this.lifetime = new AbortController();
  }
  async request<T>(
    action: string,
    method = 'GET',
    body?: unknown,
    query: Record<string, string | number> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    const lifetime = this.lifetime.signal;
    lifetime.addEventListener('abort', cancel, { once: true });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted || lifetime.aborted) abort.abort();
    const timer = setTimeout(cancel, 12000);
    try {
      const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
      const response = await this.fetcher(`/api/spotify/${action}${params.size ? `?${params}` : ''}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: abort.signal,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          code?: SpotifyErrorCode;
          message?: string;
          error?: { code?: SpotifyErrorCode; message?: string };
          retryAfter?: number;
        };
        const error = payload.error ?? payload;
        const code = error.code ?? (response.status === 401 ? 'SESSION_REQUIRED' : 'SPOTIFY_UNAVAILABLE');
        throw new SpotifyError(
          code,
          !error.message || error.message === code ? spotifyErrorMessage(code) : error.message,
          payload.retryAfter,
        );
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof SpotifyError || signal?.aborted || lifetime.aborted) throw error;
      throw new SpotifyError('SPOTIFY_UNAVAILABLE', 'Spotify non raggiungibile. Riprova esplicitamente.');
    } finally {
      clearTimeout(timer);
      lifetime.removeEventListener('abort', cancel);
      signal?.removeEventListener('abort', cancel);
    }
  }
}
