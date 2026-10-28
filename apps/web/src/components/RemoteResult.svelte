<script lang="ts">
import type { RemoteSearchResultDto } from '@spookyfy/shared';
import { ApiError } from '../lib/api';
import { formatDurationMs } from '../lib/format';
import { services } from '../lib/services.svelte';
import Icon from './Icon.svelte';

let { result }: { result: RemoteSearchResultDto } = $props();
const { jobs, player, toasts, connection, api } = services();

const job = $derived(jobs.jobFor(result.sourceId));
const readyTrack = $derived(jobs.completedTracks[result.sourceId] ?? null);
const inLibrary = $derived(result.trackId !== null || readyTrack !== null || job?.status === 'completed');
let busy = $state(false);

async function add() {
  busy = true;
  try {
    await jobs.request(result);
  } catch (err) {
    toasts.error(err instanceof ApiError ? err.message : 'Importazione non riuscita');
  } finally {
    busy = false;
  }
}

async function play() {
  // Streaming immediato: il brano è sul server (il salvataggio offline procede in parallelo).
  const id = readyTrack?.id ?? result.trackId ?? job?.trackId;
  if (!id) return;
  const track = readyTrack ?? (await api.tracks.get(id).catch(() => null));
  if (track) player.playTracks([track], 0, 'search');
}
</script>

<div class="result" data-testid="remote-result" data-source-id={result.sourceId}>
  <div class="thumb">
    <img src={result.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
  </div>
  <div class="text">
    <span class="title ellipsis">{result.title}</span>
    <span class="sub ellipsis">
      {result.artist}{result.durationMs !== null ? ` · ${formatDurationMs(result.durationMs)}` : ''}
    </span>
    {#if job && !inLibrary}
      <span class="status" data-status={job.status}>
        {#if job.status === 'queued'}In coda…
        {:else if job.status === 'running'}Importazione {Math.round(job.progress * 100)}%
        {:else if job.status === 'failed'}<span class="err">{job.error ?? 'Importazione non riuscita'}</span>{/if}
      </span>
    {/if}
  </div>
  <div class="action">
    {#if inLibrary}
      <button class="icon-btn accent" aria-label={`Riproduci ${result.title}`} onclick={play}>
        <Icon name="play" />
      </button>
    {:else if job?.status === 'failed'}
      <button class="pill" onclick={() => void jobs.retry(job).catch(() => toasts.error('Riprova non riuscita'))} disabled={connection.offline}>
        Riprova
      </button>
    {:else if job?.status === 'queued' || job?.status === 'running'}
      <span class="spinner" role="progressbar" aria-label="Importazione in corso" aria-valuenow={Math.round((job.progress ?? 0) * 100)}></span>
    {:else}
      <button class="pill" onclick={add} disabled={busy || connection.offline} aria-label={`Aggiungi ${result.title} alla libreria`}>
        <Icon name="plus" size={18} /> Aggiungi
      </button>
    {/if}
  </div>
</div>

<style>
  .result {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--row-h);
    padding: var(--space-1) 0;
  }
  .thumb {
    flex: none;
    width: 64px;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-s);
    overflow: hidden;
    background: var(--surface-3);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .sub,
  .status {
    font-size: var(--fs-s);
    color: var(--text-2);
  }
  .status {
    color: var(--accent);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .err {
    color: var(--danger);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 36px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-pill);
    border: 1px solid var(--text-3);
    font-size: var(--fs-s);
    font-weight: 700;
  }
  .accent {
    color: var(--accent);
  }
  .spinner {
    display: block;
    width: 24px;
    height: 24px;
    margin: 10px;
    border-radius: 50%;
    border: 3px solid var(--surface-hover);
    border-top-color: var(--accent);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
