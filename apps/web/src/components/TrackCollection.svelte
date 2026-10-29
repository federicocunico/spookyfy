<script lang="ts">
import type { TrackDto } from '@spookyfy/shared';
import type { Snippet } from 'svelte';
import { formatLongDuration, pluralize } from '../lib/format';
import { services } from '../lib/services.svelte';
import Icon from './Icon.svelte';
import Skeleton from './Skeleton.svelte';
import TrackRow from './TrackRow.svelte';

interface CollectionItem {
  key: string;
  track: TrackDto;
  itemId?: string;
}

let {
  title,
  kind = 'Playlist',
  tint = '#3b2d5c',
  cover,
  items,
  context,
  playlistId,
  onreorder,
  headerActions,
  emptyText = 'Nessun brano.',
}: {
  title: string;
  kind?: string;
  tint?: string;
  cover: Snippet;
  items: CollectionItem[] | null;
  context: string;
  playlistId?: string;
  onreorder?: (itemId: string, toIndex: number) => void;
  headerActions?: Snippet;
  emptyText?: string;
} = $props();

const { player, downloads, connection, router, mode, isLocal } = services();
const tracks = $derived(items?.map((i) => i.track) ?? []);
const totalMs = $derived(tracks.reduce((s, t) => s + t.durationMs, 0));
const allDownloaded = $derived(tracks.length > 0 && tracks.every((t) => downloads.isDownloaded(t.id)));
const playable = $derived(
  mode === 'client'
    ? tracks.filter((t) => isLocal(t.id))
    : connection.offline
      ? tracks.filter((t) => downloads.isDownloaded(t.id))
      : tracks,
);

function play(index: number) {
  player.playTracks(tracks, index, context);
}
function playAll(shuffle = false) {
  if (playable.length === 0) return;
  const start = shuffle ? Math.floor(Math.random() * playable.length) : 0;
  player.playTracks(playable, start, context);
  if (shuffle !== player.shuffle) player.toggleShuffle();
}

// ---------- riordino (trascinamento della maniglia o frecce da tastiera) ----------
const ROW_H = 64;
let drag = $state<{ itemId: string; from: number; dy: number } | null>(null);
let startY = 0;
const dragTarget = $derived(
  drag && items ? Math.max(0, Math.min(items.length - 1, drag.from + Math.round(drag.dy / ROW_H))) : null,
);

function shiftFor(index: number): number {
  if (!drag || dragTarget === null || index === drag.from) return 0;
  if (drag.from < dragTarget && index > drag.from && index <= dragTarget) return -ROW_H;
  if (drag.from > dragTarget && index < drag.from && index >= dragTarget) return ROW_H;
  return 0;
}

function handleDown(e: PointerEvent, itemId: string, from: number) {
  startY = e.clientY;
  drag = { itemId, from, dy: 0 };
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}
function handleMove(e: PointerEvent) {
  if (drag) drag = { ...drag, dy: e.clientY - startY };
}
function handleUp() {
  if (!drag) return;
  const { itemId, from } = drag;
  const to = dragTarget ?? from;
  drag = null;
  if (to !== from) onreorder?.(itemId, to);
}
function handleKey(e: KeyboardEvent, itemId: string, index: number) {
  if (!items) return;
  if (e.key === 'ArrowUp' && index > 0) onreorder?.(itemId, index - 1);
  else if (e.key === 'ArrowDown' && index < items.length - 1) onreorder?.(itemId, index + 1);
  else return;
  e.preventDefault();
}
</script>

<div class="collection" style:--tint={tint}>
  <header class="hero">
    <button class="icon-btn back" aria-label="Indietro" onclick={() => router.back('/library')}>
      <Icon name="chevron-left" size={28} />
    </button>
    <div class="art">{@render cover()}</div>
    <h1 class="title">{title}</h1>
    <p class="muted meta">
      {kind}{items ? ` · ${pluralize(items.length, 'brano', 'brani')}` : ''}{totalMs > 0 ? ` · ${formatLongDuration(totalMs)}` : ''}
    </p>
    <div class="bar">
      <div class="left">
        {#if tracks.length > 0 && mode === 'onpremise'}
          <button
            class="icon-btn"
            class:on={allDownloaded}
            aria-label={allDownloaded ? 'Tutti i brani sono scaricati' : 'Scarica tutti i brani'}
            disabled={allDownloaded || connection.offline}
            onclick={() => void downloads.downloadAll(tracks)}
          >
            <Icon name={allDownloaded ? 'check' : 'cloud'} size={26} />
          </button>
        {/if}
        {#if headerActions}{@render headerActions()}{/if}
      </div>
      <div class="right">
        <button class="icon-btn" aria-label="Riproduci in ordine casuale" disabled={playable.length === 0} onclick={() => playAll(true)}>
          <Icon name="shuffle" />
        </button>
        <button class="play" aria-label={`Riproduci ${title}`} disabled={playable.length === 0} onclick={() => playAll(false)}>
          <Icon name="play" size={28} />
        </button>
      </div>
    </div>
  </header>

  <div
    class="tracks"
    role="presentation"
    onpointermove={handleMove}
    onpointerup={handleUp}
    onpointercancel={() => (drag = null)}
  >
    {#if items === null}
      <Skeleton rows={6} />
    {:else if items.length === 0}
      <p class="empty-state">{emptyText}</p>
    {:else}
      {#each items as item, i (item.key)}
        <div
          class="slot"
          class:dragging={drag?.itemId === item.itemId}
          style:transform={drag && drag.itemId === item.itemId
            ? `translateY(${drag.dy}px)`
            : `translateY(${shiftFor(i)}px)`}
        >
          <TrackRow track={item.track} onplay={() => play(i)} {playlistId} itemId={item.itemId}>
            {#snippet leading()}
              {#if onreorder && item.itemId}
                <button
                  class="handle"
                  aria-label={`Sposta ${item.track.title} (frecce su e giù)`}
                  disabled={connection.offline}
                  onpointerdown={(e) => handleDown(e, item.itemId!, i)}
                  onkeydown={(e) => handleKey(e, item.itemId!, i)}
                >
                  <Icon name="grip" size={20} />
                </button>
              {/if}
            {/snippet}
          </TrackRow>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .hero {
    position: relative;
    display: grid;
    justify-items: center;
    padding: calc(var(--safe-top) + var(--space-3)) var(--space-4) var(--space-2);
    background: linear-gradient(180deg, color-mix(in srgb, var(--tint) 55%, var(--bg)) 0%, var(--bg) 100%);
  }
  .back {
    position: absolute;
    left: var(--space-2);
    top: calc(var(--safe-top) + var(--space-2));
    color: var(--text);
  }
  .art {
    width: min(60vw, 240px);
    margin: var(--space-6) 0 var(--space-4);
    box-shadow: var(--shadow-cover);
  }
  .title {
    justify-self: start;
    font-size: var(--fs-xl);
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .meta {
    justify-self: start;
    font-size: var(--fs-s);
    margin-top: var(--space-1);
  }
  .bar {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--space-2);
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .on {
    color: var(--accent);
  }
  .play {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
  }
  .play:active:not(:disabled) {
    transform: scale(0.95);
  }
  .tracks {
    padding: 0 var(--space-4) calc(var(--tabbar-h) + var(--miniplayer-h) + var(--safe-bottom) + var(--space-6));
  }
  .slot {
    position: relative;
    transition: transform 0.18s var(--ease-out);
    background: var(--bg);
  }
  .slot.dragging {
    z-index: 2;
    transition: none;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    background: var(--surface-3);
  }
  .handle {
    display: grid;
    place-items: center;
    width: 32px;
    height: 44px;
    color: var(--text-3);
    touch-action: none;
    cursor: grab;
  }
</style>
