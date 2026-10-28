<script lang="ts">
import type { TrackDto } from '@spookyfy/shared';
import { services } from '../lib/services.svelte';
import Icon from './Icon.svelte';

let { track, size = 24 }: { track: TrackDto; size?: number } = $props();
const { downloads, connection } = services();

const status = $derived(downloads.status(track.id));
const progress = $derived(downloads.progress(track.id));
const label = $derived(
  status === 'downloaded'
    ? 'Rimuovi download'
    : status === 'downloading'
      ? `Download in corso, ${Math.round(progress * 100)}%`
      : status === 'queued'
        ? 'In coda per il download'
        : 'Scarica',
);
const R = 9;
const C = 2 * Math.PI * R;

function onclick(e: MouseEvent) {
  e.stopPropagation();
  if (status === 'downloaded' || status === 'downloading' || status === 'queued') {
    void downloads.remove(track.id);
  } else {
    void downloads.download(track).catch(() => {});
  }
}
</script>

<button
  class="toggle"
  class:on={status === 'downloaded'}
  aria-label={label}
  aria-pressed={status === 'downloaded'}
  data-status={status}
  disabled={status === 'none' && connection.offline}
  {onclick}
>
  {#if status === 'downloading' || status === 'queued'}
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r={R} fill="none" stroke="var(--surface-hover)" stroke-width="2.5" />
      <circle
        class="ring"
        cx="12"
        cy="12"
        r={R}
        fill="none"
        stroke="var(--accent)"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-dasharray={C}
        stroke-dashoffset={C * (1 - progress)}
        transform="rotate(-90 12 12)"
      />
    </svg>
  {:else}
    <Icon name={status === 'downloaded' ? 'check' : 'cloud'} {size} />
  {/if}
</button>

<style>
  .toggle {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    color: var(--text-2);
  }
  .toggle.on {
    color: var(--accent);
  }
  .ring {
    transition: stroke-dashoffset 0.2s linear;
  }
</style>
