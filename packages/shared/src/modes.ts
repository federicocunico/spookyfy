/** Modalità del backend: libreria e streaming sul server, oppure tutto sul dispositivo. */
export type BackendMode = 'onpremise' | 'client';

export const Feature = {
  /** Libreria condivisa sul server, con streaming dei brani. */
  ServerLibrary: 'server-library',
  /** Ricerca su YouTube dal backend. */
  RemoteSearch: 'remote-search',
  /** Importazione con job sul server e canale in tempo reale. */
  ServerIngest: 'server-ingest',
  /** Importazione verso il dispositivo tramite gateway (metadati, audio, copertine). */
  DeviceIngest: 'device-ingest',
  /** Token di accesso personali per il ponte da un'app in modalità client. */
  BridgeTokens: 'bridge-tokens',
  /** Ricerca online di copertine e metadati degli album. */
  CoverLookup: 'cover-lookup',
  /** Registrazione dall'app con token di invito. */
  Registration: 'registration',
} as const;
export type Feature = (typeof Feature)[keyof typeof Feature];

/** Risposta pubblica di `GET /api/health`: nessun dato sugli utenti. */
export interface HealthDto {
  status: 'ok';
  mode: BackendMode;
  version: string;
  features: Feature[];
}

export const HEALTH_PATH = '/api/health';
