import { z } from 'zod';
import type { TrackDto } from './library.js';

export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
export const MAX_TRACK_DURATION_SEC = 20 * 60;
export const REMOTE_SEARCH_LIMIT = 10;

export const remoteSearchQuerySchema = z.object({
  q: z
    .string({ required_error: 'Inserisci cosa cercare' })
    .trim()
    .min(1, 'Inserisci cosa cercare')
    .max(200, 'La ricerca può avere al massimo 200 caratteri'),
});

export interface RemoteSearchResultDto {
  sourceId: string;
  title: string;
  artist: string;
  durationMs: number | null;
  thumbnailUrl: string;
  /** Id del brano in libreria se il video è già stato importato. */
  trackId: string | null;
}

export const ingestBodySchema = z.object({
  sourceId: z
    .string({ required_error: 'Identificativo mancante' })
    .regex(YOUTUBE_ID_PATTERN, 'Identificativo di video YouTube non valido'),
});

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface JobDto {
  id: string;
  sourceId: string;
  status: JobStatus;
  /** Avanzamento da 0 a 1. */
  progress: number;
  error: string | null;
  trackId: string | null;
  /** Id dell'utente che ha richiesto l'importazione. */
  requestedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export type IngestResponse = { kind: 'track'; track: TrackDto } | { kind: 'job'; job: JobDto };

/** Messaggi inviati dal server sul canale in tempo reale `/api/ws`. */
export type WsServerEvent =
  | { type: 'job.queued'; job: JobDto }
  | { type: 'job.progress'; job: JobDto }
  | { type: 'job.completed'; job: JobDto; track: TrackDto }
  | { type: 'job.failed'; job: JobDto };

export const WS_PATH = '/api/ws';
