import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ErrorCode,
  type IngestResponse,
  type JobDto,
  type JobStatus,
  type RemoteSearchResultDto,
} from '@spookyfy/shared';
import { cleanMetadata } from '@spookyfy/shared';
import type Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';
import { ulid } from 'ulid';
import type { Clock } from '../clock.js';
import { HttpError, notFound } from '../http-errors.js';
import type { TrackService } from '../library/tracks.js';
import { COVER_SIZES, absMediaPath, audioRelPath, coverRelPath, coverRelPrefix } from '../media/paths.js';
import type { SilenceAnalyzer } from '../media/silence.js';
import { writeTags } from '../media/tags.js';
import { processCover } from './covers.js';
import type { IngestEvents } from './events.js';
import { type YtDlp, YtDlpError } from './ytdlp.js';

interface JobRow {
  id: string;
  source_id: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  track_id: string | null;
  requested_by: string | null;
  created_at: number;
  updated_at: number;
}

const toJobDto = (r: JobRow): JobDto => ({
  id: r.id,
  sourceId: r.source_id,
  status: r.status,
  progress: r.progress,
  error: r.error,
  trackId: r.track_id,
  requestedBy: r.requested_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 200;
const PROGRESS_EVENT_INTERVAL_MS = 1000;
const FINISHED_JOBS_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Il download pesa il 90% dell'avanzamento; il resto è conversione e salvataggio. */
const DOWNLOAD_SHARE = 0.9;

export interface IngestServiceOptions {
  sqlite: Database.Database;
  mediaDir: string;
  clock: Clock;
  ytdlp: YtDlp;
  events: IngestEvents;
  tracks: TrackService;
  concurrency: number;
  log: FastifyBaseLogger;
  /** Auto-trim: silenzio ai bordi del brano (ffmpeg). Senza, i brani si riproducono interi. */
  analyzeSilence?: SilenceAnalyzer;
}

export class IngestService {
  private readonly running = new Map<string, { abort: AbortController; done: Promise<void> }>();
  private readonly searchCache = new Map<
    string,
    { at: number; items: Awaited<ReturnType<YtDlp['search']>> }
  >();
  private readonly lastProgressEvent = new Map<string, number>();
  private stopped = true;

  constructor(private readonly o: IngestServiceOptions) {}

  get events(): IngestEvents {
    return this.o.events;
  }

  private get tmpDir() {
    return path.join(this.o.mediaDir, 'tmp');
  }

  private row(id: string): JobRow | undefined {
    return this.o.sqlite.prepare('SELECT * FROM ingest_jobs WHERE id = ?').get(id) as JobRow | undefined;
  }

  private job(id: string): JobDto {
    const r = this.row(id);
    if (!r) throw notFound('Job non trovato');
    return toJobDto(r);
  }

  private setStatus(
    id: string,
    fields: Partial<Pick<JobRow, 'status' | 'progress' | 'error' | 'track_id'>>,
  ): JobDto {
    const sets = Object.keys(fields).map((k) => `${k} = @${k}`);
    this.o.sqlite
      .prepare(`UPDATE ingest_jobs SET ${[...sets, 'updated_at = @now'].join(', ')} WHERE id = @id`)
      .run({ ...fields, id, now: this.o.clock.now() });
    return this.job(id);
  }

  // ---------- ricerca ----------

  async search(userId: string, query: string): Promise<RemoteSearchResultDto[]> {
    const key = query.toLowerCase();
    const now = this.o.clock.now();
    let cached = this.searchCache.get(key);
    if (!cached || now - cached.at > SEARCH_CACHE_TTL_MS) {
      try {
        // Timeout predefinito del wrapper: 15 s.
        cached = { at: now, items: await this.o.ytdlp.search(query) };
      } catch (err) {
        this.o.log.warn({ err }, 'ricerca remota non riuscita');
        throw new HttpError(
          503,
          ErrorCode.RemoteSearchUnavailable,
          'La ricerca su YouTube non è disponibile al momento. Riprova più tardi.',
        );
      }
      this.searchCache.set(key, cached);
      if (this.searchCache.size > SEARCH_CACHE_MAX)
        this.searchCache.delete(this.searchCache.keys().next().value!);
    }
    return cached.items.map((i) => ({
      sourceId: i.sourceId,
      title: i.title,
      artist: i.channel,
      durationMs: i.durationSec === null ? null : Math.round(i.durationSec * 1000),
      thumbnailUrl: i.thumbnailUrl,
      trackId: this.o.tracks.bySourceId(userId, i.sourceId)?.id ?? null,
    }));
  }

  // ---------- richieste e consultazione ----------

  request(userId: string, sourceId: string): IngestResponse {
    const existing = this.o.tracks.bySourceId(userId, sourceId);
    if (existing) return { kind: 'track', track: existing };
    const active = this.o.sqlite
      .prepare("SELECT * FROM ingest_jobs WHERE source_id = ? AND status IN ('queued', 'running') LIMIT 1")
      .get(sourceId) as JobRow | undefined;
    if (active) return { kind: 'job', job: toJobDto(active) };

    const id = ulid();
    const now = this.o.clock.now();
    this.o.sqlite
      .prepare(
        `INSERT INTO ingest_jobs (id, source_id, status, progress, requested_by, created_at, updated_at)
         VALUES (?, ?, 'queued', 0, ?, ?, ?)`,
      )
      .run(id, sourceId, userId, now, now);
    const job = this.job(id);
    this.o.events.emit({ type: 'job.queued', job });
    this.pump();
    return { kind: 'job', job };
  }

  /** Job attivi e quelli terminati nelle ultime 24 ore, dal più recente. */
  list(): JobDto[] {
    const since = this.o.clock.now() - FINISHED_JOBS_WINDOW_MS;
    const rows = this.o.sqlite
      .prepare(
        `SELECT * FROM ingest_jobs WHERE status IN ('queued', 'running') OR updated_at >= ?
         ORDER BY created_at DESC, id DESC LIMIT 200`,
      )
      .all(since) as JobRow[];
    return rows.map(toJobDto);
  }

  retry(id: string): JobDto {
    const job = this.job(id);
    if (job.status !== 'failed') {
      throw new HttpError(409, ErrorCode.Conflict, 'Si può riprovare solo un job fallito');
    }
    const queued = this.setStatus(id, { status: 'queued', progress: 0, error: null });
    this.o.events.emit({ type: 'job.queued', job: queued });
    this.pump();
    return queued;
  }

  // ---------- worker ----------

  /** Riprende i job interrotti da un arresto e avvia l'elaborazione. */
  async start(): Promise<void> {
    await fs.rm(this.tmpDir, { recursive: true, force: true });
    await fs.mkdir(this.tmpDir, { recursive: true });
    const r = this.o.sqlite
      .prepare(
        "UPDATE ingest_jobs SET status = 'queued', progress = 0, updated_at = ? WHERE status = 'running'",
      )
      .run(this.o.clock.now());
    if (r.changes) this.o.log.info({ jobs: r.changes }, 'job interrotti rimessi in coda');
    this.stopped = false;
    this.pump();
    const abort = new AbortController();
    this.backlog = { abort, done: this.analyzeSilenceBacklog(abort.signal).then(() => {}) };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.backlog?.abort.abort();
    for (const { abort } of this.running.values()) abort.abort();
    await Promise.allSettled([...this.running.values()].map((r) => r.done));
    await this.backlog?.done;
  }

  private backlog: { abort: AbortController; done: Promise<void> } | null = null;

  /**
   * Auto-trim dei brani mai analizzati (importati prima della funzione o senza ffmpeg):
   * uno alla volta in background, dai più recenti. Dopo alcuni fallimenti di fila (es.
   * ffmpeg assente) si ferma e riprova al prossimo avvio. Restituisce i brani analizzati.
   */
  async analyzeSilenceBacklog(signal?: AbortSignal): Promise<number> {
    const analyze = this.o.analyzeSilence;
    if (!analyze) return 0;
    const { sqlite, mediaDir } = this.o;
    const failed: string[] = [];
    let analyzed = 0;
    let failures = 0;
    while (!signal?.aborted && failures < 3) {
      const row = sqlite
        .prepare(
          `SELECT id, audio_path FROM tracks WHERE silence_checked = 0
           AND id NOT IN (SELECT value FROM json_each(?)) ORDER BY added_at DESC LIMIT 1`,
        )
        .get(JSON.stringify(failed)) as { id: string; audio_path: string } | undefined;
      if (!row) break;
      const trim = await analyze(absMediaPath(mediaDir, row.audio_path), { signal });
      if (!trim) {
        failed.push(row.id);
        failures++;
        continue;
      }
      failures = 0;
      analyzed++;
      sqlite
        .prepare('UPDATE tracks SET trim_start_ms = ?, trim_end_ms = ?, silence_checked = 1 WHERE id = ?')
        .run(trim.trimStartMs ?? null, trim.trimEndMs ?? null, row.id);
    }
    if (failures >= 3 && !signal?.aborted)
      this.o.log.warn('auto-trim non disponibile: analisi del silenzio non riuscita (ffmpeg installato?)');
    if (analyzed) this.o.log.info({ tracks: analyzed }, 'auto-trim: brani analizzati');
    return analyzed;
  }

  /** Attende che non ci siano job in esecuzione (per i test). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running.values()].map((r) => r.done));
  }

  private pump(): void {
    if (this.stopped) return;
    while (this.running.size < this.o.concurrency) {
      const next = this.o.sqlite
        .prepare(
          `SELECT * FROM ingest_jobs WHERE status = 'queued'
           AND id NOT IN (SELECT value FROM json_each(?)) ORDER BY created_at, id LIMIT 1`,
        )
        .get(JSON.stringify([...this.running.keys()])) as JobRow | undefined;
      if (!next) return;
      const abort = new AbortController();
      const done = this.process(next, abort.signal).finally(() => {
        this.running.delete(next.id);
        this.lastProgressEvent.delete(next.id);
        this.pump();
      });
      this.running.set(next.id, { abort, done });
    }
  }

  private reportProgress(id: string, fraction: number, force = false): void {
    const now = this.o.clock.now();
    const last = this.lastProgressEvent.get(id);
    if (!force && last !== undefined && now - last < PROGRESS_EVENT_INTERVAL_MS) return;
    this.lastProgressEvent.set(id, now);
    const job = this.setStatus(id, { status: 'running', progress: Math.round(fraction * 1000) / 1000 });
    this.o.events.emit({ type: 'job.progress', job });
  }

  private async process(row: JobRow, signal: AbortSignal): Promise<void> {
    const { sqlite, mediaDir } = this.o;
    const workDir = path.join(this.tmpDir, row.id);
    const finalFiles: string[] = [];
    try {
      // Un altro job potrebbe aver già importato lo stesso video.
      const already = sqlite.prepare('SELECT id FROM tracks WHERE source_id = ?').get(row.source_id) as
        | { id: string }
        | undefined;
      if (already) {
        this.complete(row, already.id);
        return;
      }
      this.reportProgress(row.id, 0, true);
      await fs.rm(workDir, { recursive: true, force: true });
      await fs.mkdir(workDir, { recursive: true });

      const dl = await this.o.ytdlp.download(row.source_id, workDir, {
        signal,
        onProgress: (f) => this.reportProgress(row.id, f * DOWNLOAD_SHARE),
      });
      const meta = cleanMetadata(dl.info);
      const cover = await processCover(dl.thumbnailFile);
      await writeTags(dl.audioFile, { ...meta, cover: cover.large });
      if (signal.aborted) throw new YtDlpError('aborted', 'Download interrotto');

      const trackId = ulid();
      const audio = audioRelPath(trackId);
      const coverPrefix = coverRelPrefix(trackId);
      const audioAbs = absMediaPath(mediaDir, audio);
      await fs.mkdir(path.dirname(audioAbs), { recursive: true });
      await fs.mkdir(path.dirname(absMediaPath(mediaDir, coverPrefix)), { recursive: true });
      // Copertine prima, audio per ultimo: i rename nella stessa partizione sono atomici.
      for (const size of COVER_SIZES) {
        const file = absMediaPath(mediaDir, coverRelPath(coverPrefix, size));
        await fs.writeFile(`${file}.tmp`, size === 512 ? cover.large : cover.thumb);
        finalFiles.push(file);
        await fs.rename(`${file}.tmp`, file);
      }
      finalFiles.push(audioAbs);
      await fs.rename(dl.audioFile, audioAbs);
      const { size } = await fs.stat(audioAbs);

      const durationMs = Math.round((dl.info.duration ?? 0) * 1000);
      // Un'analisi non riuscita non blocca l'importazione: il brano resta da analizzare.
      const trim = this.o.analyzeSilence ? await this.o.analyzeSilence(audioAbs, { signal }) : null;
      const now = this.o.clock.now();
      sqlite.transaction(() => {
        sqlite
          .prepare(
            `INSERT INTO tracks (id, source, source_id, title, artist, album, duration_ms, trim_start_ms, trim_end_ms,
               silence_checked, size_bytes, dominant_color, audio_path, cover_path, added_by, added_at)
             VALUES (@id, 'youtube', @sourceId, @title, @artist, @album, @durationMs, @trimStart, @trimEnd,
               @silenceChecked, @size, @color, @audio, @cover, @addedBy, @now)`,
          )
          .run({
            id: trackId,
            sourceId: row.source_id,
            ...meta,
            durationMs,
            trimStart: trim?.trimStartMs ?? null,
            trimEnd: trim?.trimEndMs ?? null,
            silenceChecked: trim ? 1 : 0,
            size,
            color: cover.dominantColor,
            audio,
            cover: coverPrefix,
            addedBy: row.requested_by,
            now,
          });
        sqlite
          .prepare(
            "UPDATE ingest_jobs SET status = 'completed', progress = 1, error = NULL, track_id = ?, updated_at = ? WHERE id = ?",
          )
          .run(trackId, now, row.id);
      })();
      finalFiles.length = 0;
      this.emitCompleted(row.id, trackId, row.requested_by);
    } catch (err) {
      await Promise.all(finalFiles.map((f) => fs.rm(f, { force: true })));
      if (signal.aborted && this.stopped) {
        // Arresto del server: il job resta "running" e verrà rimesso in coda al riavvio.
        return;
      }
      const message =
        err instanceof YtDlpError ? err.message : 'Importazione non riuscita per un errore interno';
      if (!(err instanceof YtDlpError)) this.o.log.error({ err, jobId: row.id }, 'importazione fallita');
      const job = this.setStatus(row.id, { status: 'failed', error: message });
      this.o.events.emit({ type: 'job.failed', job });
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }

  private complete(row: JobRow, trackId: string): void {
    this.setStatus(row.id, { status: 'completed', progress: 1, error: null, track_id: trackId });
    this.emitCompleted(row.id, trackId, row.requested_by);
  }

  private emitCompleted(jobId: string, trackId: string, userId: string | null): void {
    const track = this.o.tracks.get(userId ?? '', trackId);
    this.o.events.emit({ type: 'job.completed', job: this.job(jobId), track });
  }
}
