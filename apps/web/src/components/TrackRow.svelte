<script lang="ts">
import type { TrackDto } from '@spookyfy/shared';
import type { Snippet } from 'svelte';
import { formatDurationMs } from '../lib/format';
import { services } from '../lib/services.svelte';
import Cover from './Cover.svelte';
import Icon from './Icon.svelte';

let {
  track,
  onplay,
  playlistId,
  itemId,
  leading,
}: {
  track: TrackDto;
  onplay?: () => void;
  playlistId?: string;
  itemId?: string;
  /** Contenuto a sinistra (es. maniglia di trascinamento). */
  leading?: Snippet;
} = $props();

const { player, downloads, connection, ui } = services();
const isCurrent = $derived(player.current?.id === track.id);
const downloaded = $derived(downloads.isDownloaded(track.id));
// Offline i brani non scaricati sono attenuati e non selezionabili.
const unavailable = $derived(connection.offline && !downloaded);

function openMenu(e: MouseEvent) {
  e.stopPropagation();
  ui.menu = { track, playlistId, itemId };
}
</script>

<div class="row" class:unavailable class:current={isCurrent} data-testid="track-row">
  {#if leading}{@render leading()}{/if}
  <button
    class="main"
    onclick={() => onplay?.()}
    disabled={unavailable || !onplay}
    aria-label={`Riproduci ${track.title} di ${track.artist}`}
  >
    <Cover src={track.coverThumbUrl} color={track.dominantColor} size={48} />
    <span class="text">
      <span class="title ellipsis">{track.title}</span>
      <span class="sub ellipsis">
        {#if downloaded}<span class="dl" aria-label="Scaricato"><Icon name="check" size={14} /></span>{/if}
        {track.artist}
      </span>
    </span>
    <span class="duration">{formatDurationMs(track.durationMs)}</span>
  </button>
  <button class="icon-btn menu" aria-label={`Altre azioni per ${track.title}`} onclick={openMenu}>
    <Icon name="more" size={20} />
  </button>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    height: var(--row-h);
    gap: var(--space-1);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 100%;
    text-align: left;
  }
  .main:disabled {
    opacity: 1;
  }
  .main:active:not(:disabled) {
    opacity: 0.7;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .title {
    font-size: var(--fs-m);
  }
  .current .title {
    color: var(--accent);
  }
  .sub {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--fs-s);
    color: var(--text-2);
  }
  .dl {
    color: var(--accent);
    flex: none;
  }
  .duration {
    font-size: var(--fs-s);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .unavailable .main {
    opacity: 0.38;
  }
</style>
