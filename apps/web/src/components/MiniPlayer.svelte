<script lang="ts">
import { services } from '../lib/services.svelte';
import Cover from './Cover.svelte';
import Icon from './Icon.svelte';
import Marquee from './Marquee.svelte';

const { player, router, spotify } = services();
const track = $derived(player.current);
const progress = $derived(player.duration > 0 ? Math.min(1, player.position / player.duration) : 0);

// Swipe verso l'alto per aprire il player a schermo intero.
const OPEN_DISTANCE = 40;
let startY: number | null = null;
let dragY = $state(0);

function onpointerdown(e: PointerEvent) {
  if ((e.target as HTMLElement).closest('button')) return;
  startY = e.clientY;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}
function onpointermove(e: PointerEvent) {
  if (startY === null) return;
  dragY = Math.min(0, e.clientY - startY);
}
function onpointerup(e: PointerEvent) {
  if (startY === null) return;
  const dy = e.clientY - startY;
  startY = null;
  dragY = 0;
  // Tap (movimento minimo) o swipe verso l'alto: apre il player.
  if (dy <= -OPEN_DISTANCE || Math.abs(dy) < 8) router.openOverlay('player');
}
function onpointercancel() {
  startY = null;
  dragY = 0;
}
function onkeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    router.openOverlay('player');
  }
}
</script>

{#if track && !spotify.active}
  <div
    class="mini"
    role="button"
    tabindex="0"
    aria-label={`In riproduzione: ${track.title} di ${track.artist}. Apri il player`}
    style:transform={dragY ? `translateY(${dragY / 3}px)` : undefined}
    style:--tint={track.dominantColor}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    {onpointercancel}
    {onkeydown}
    data-testid="mini-player"
  >
    <Cover src={track.coverThumbUrl} color={track.dominantColor} size={40} />
    <div class="text">
      <Marquee text={track.title} class="title" />
      <span class="artist ellipsis">File locale · {track.artist}</span>
    </div>
    <button
      class="icon-btn play"
      aria-label={player.playing ? 'Pausa' : 'Riproduci'}
      onclick={(e) => {
        e.stopPropagation();
        player.toggle();
      }}
    >
      <Icon name={player.playing ? 'pause' : 'play'} size={26} />
    </button>
    <div class="progress" aria-hidden="true"><div class="bar" style:transform={`scaleX(${progress})`}></div></div>
  </div>
{/if}

<style>
  .mini {
    position: fixed;
    left: var(--space-2);
    right: var(--space-2);
    bottom: calc(var(--tabbar-h) + var(--safe-bottom) + var(--space-1));
    z-index: var(--z-miniplayer);
    height: var(--miniplayer-h);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-1) 0 var(--space-2);
    border-radius: var(--radius-m);
    background: color-mix(in srgb, var(--tint) 35%, var(--surface-3));
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    touch-action: none;
    cursor: pointer;
    transition: background 0.4s ease;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .text :global(.title) {
    font-size: var(--fs-s);
    font-weight: 600;
  }
  .artist {
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .play {
    color: var(--text);
  }
  .progress {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: 0;
    height: 2px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 1px;
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--text);
    transform-origin: left;
  }
</style>
