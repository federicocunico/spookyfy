import type { JobDto, RemoteSearchResultDto, TrackDto, WsServerEvent } from '@spookyfy/shared';
import type { Api } from '../api';
import type { Toasts } from './toasts.svelte';

const DEVICE_JOBS_KEY = 'spk-device-jobs';

export interface JobsDeps {
  api: Api;
  toasts: Pick<Toasts, 'show' | 'error'>;
  /** Brano importato su richiesta di questo dispositivo: va salvato offline. */
  onOwnTrackReady?(track: TrackDto): void;
  /** Un brano nuovo è entrato in libreria (aggiornare le liste). */
  onTrackAdded?(track: TrackDto): void;
  storage?: Storage;
}

/** Stato delle importazioni, aggiornato in tempo reale dagli eventi del server. */
export class Jobs {
  bySource = $state<Record<string, JobDto>>({});
  /** Brani appena importati, per mostrare subito "Riproduci" nei risultati. */
  completedTracks = $state<Record<string, TrackDto>>({});
  /** Id dei job richiesti da questo dispositivo (sopravvive a un ricaricamento). */
  private deviceJobs: Set<string>;
  private readonly storage: Storage | undefined;

  constructor(private readonly deps: JobsDeps) {
    this.storage = deps.storage ?? globalThis.localStorage;
    try {
      this.deviceJobs = new Set(JSON.parse(this.storage?.getItem(DEVICE_JOBS_KEY) ?? '[]') as string[]);
    } catch {
      this.deviceJobs = new Set();
    }
  }

  private saveDeviceJobs(): void {
    try {
      this.storage?.setItem(DEVICE_JOBS_KEY, JSON.stringify([...this.deviceJobs]));
    } catch {}
  }

  jobFor(sourceId: string): JobDto | undefined {
    return this.bySource[sourceId];
  }

  isRequestedHere(jobId: string): boolean {
    return this.deviceJobs.has(jobId);
  }

  private upsert(job: JobDto): void {
    const prev = this.bySource[job.sourceId];
    // Gli eventi possono arrivare fuori ordine rispetto al ricaricamento della lista.
    if (prev && prev.id === job.id && prev.updatedAt > job.updatedAt) return;
    this.bySource = { ...this.bySource, [job.sourceId]: job };
  }

  /** Richiede l'importazione di un risultato della ricerca remota. */
  async request(result: Pick<RemoteSearchResultDto, 'sourceId' | 'title'>): Promise<TrackDto | null> {
    const res = await this.deps.api.remote.ingest(result.sourceId);
    if (res.kind === 'track') {
      this.completedTracks = { ...this.completedTracks, [result.sourceId]: res.track };
      return res.track;
    }
    this.deviceJobs.add(res.job.id);
    this.saveDeviceJobs();
    this.upsert(res.job);
    return null;
  }

  async retry(job: JobDto): Promise<void> {
    this.upsert(await this.deps.api.remote.retry(job.id));
    this.deviceJobs.add(job.id);
    this.saveDeviceJobs();
  }

  /** Registra un'importazione avviata da questo dispositivo fuori da `request` (es. tramite ponte). */
  adopt(job: JobDto): void {
    this.deviceJobs.add(job.id);
    this.saveDeviceJobs();
    this.upsert(job);
  }

  /** Stato attuale dal server (all'avvio e dopo una riconnessione). */
  async reload(): Promise<void> {
    const { items } = await this.deps.api.remote.jobs();
    for (const job of [...items].reverse()) this.upsert(job);
  }

  handleEvent(event: WsServerEvent): void {
    this.upsert(event.job);
    if (event.type === 'job.completed') {
      this.completedTracks = { ...this.completedTracks, [event.job.sourceId]: event.track };
      this.deps.onTrackAdded?.(event.track);
      if (this.deviceJobs.delete(event.job.id)) {
        this.saveDeviceJobs();
        this.deps.toasts.show(`«${event.track.title}» è in libreria`);
        this.deps.onOwnTrackReady?.(event.track);
      }
    } else if (event.type === 'job.failed' && this.deviceJobs.has(event.job.id)) {
      this.deps.toasts.error(event.job.error ?? 'Importazione non riuscita');
    }
  }
}
