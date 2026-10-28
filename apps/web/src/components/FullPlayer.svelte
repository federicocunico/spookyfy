<script lang="ts">
import { services } from '../lib/services.svelte';
import Cover from './Cover.svelte';
import DownloadToggle from './DownloadToggle.svelte';
import Icon from './Icon.svelte';
import Marquee from './Marquee.svelte';
import ScrubBar from './ScrubBar.svelte';

const { player, router, library, toasts, ui, mode } = services();
const open = $derived(router.overlay === 'player' && player.current !== null);
const track = $derived(player.current);

// Trascinamento verso il basso per chiudere: il pannello segue il dito.
const CLOSE_DISTANCE = 120;
let startY: number | null = null;
let startT = 0;
let dragY = $state(0);

function onpointerdown(e: PointerEvent) {
  const t = e.target as HTMLElement;
  if (t.closest('button, [role="slider"]')) return;
  startY = e.clientY;
  startT = performance.now();
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}
function onpointermove(e: PointerEvent) {
  if (startY !== null) dragY = Math.max(0, e.clientY - startY);
}
function onpointerup() {
  if (startY === null) return;
  const velocity = dragY / Math.max(1, performance.now() - startT);
  startY = null;
  if (dragY > CLOSE_DISTANCE || velocity > 0.8) router.closeOverlay();
  dragY = 0;
}

async function toggleFavorite() {
  if (!track) return;
  try {
    await library.setFavorite(track, !track.isFavorite);
  } catch {
    toasts.error('Non è stato possibile aggiornare i preferiti');
  }
}
</script>

{#if open && track}
  <div
    class="full"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="Player"
    style:--tint={track.dominantColor}
    style:transform={dragY ? `translateY(${dragY}px)` : undefined}
    class:dragging={dragY > 0}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointercancel={() => {
      startY = null;
      dragY = 0;
    }}
    data-testid="full-player"
  >
    <header>
      <button class="icon-btn" aria-label="Chiudi il player" onclick={() => router.closeOverlay()}>
        <Icon name="chevron-down" size={28} />
      </button>
      <span class="context">In riproduzione</span>
      <button class="icon-btn" aria-label="Altre azioni" onclick={() => (ui.menu = { track })}>
        <Icon name="more" />
      </button>
    </header>

    <div class="art">
      <Cover src={track.coverUrl} color={track.dominantColor} radius="var(--radius-m)" shadow eager />
    </div>

    <div class="meta">
      <div class="names">
        <Marquee text={track.title} class="title" />
        <span class="artist ellipsis">{track.artist}</span>
      </div>
      <button
        class="icon-btn fav"
        class:on={track.isFavorite}
        aria-label={track.isFavorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
        aria-pressed={track.isFavorite}
        onclick={toggleFavorite}
      >
        <Icon name={track.isFavorite ? 'heart' : 'heart-outline'} size={26} />
      </button>
    </div>

    <ScrubBar position={player.position} duration={player.duration} onseek={(s) => player.seek(s)} />

    <div class="controls">
      <button
        class="icon-btn"
        class:on={player.shuffle}
        aria-label="Shuffle"
        aria-pressed={player.shuffle}
        onclick={() => player.toggleShuffle()}
      >
        <Icon name="shuffle" />
      </button>
      <button class="icon-btn big" aria-label="Brano precedente" onclick={() => player.previous()}>
        <Icon name="previous" size={34} />
      </button>
      <button class="play" aria-label={player.playing ? 'Pausa' : 'Riproduci'} onclick={() => player.toggle()}>
        <Icon name={player.playing ? 'pause' : 'play'} size={34} />
      </button>
      <button class="icon-btn big" aria-label="Brano successivo" onclick={() => player.next()}>
        <Icon name="next" size={34} />
      </button>
      <button
        class="icon-btn"
        class:on={player.repeat !== 'off'}
        aria-label={player.repeat === 'one' ? 'Ripeti brano' : player.repeat === 'all' ? 'Ripeti coda' : 'Ripeti disattivato'}
        aria-pressed={player.repeat !== 'off'}
        onclick={() => player.cycleRepeat()}
      >
        <Icon name={player.repeat === 'one' ? 'repeat-one' : 'repeat'} />
      </button>
    </div>

    <div class="extras">
      {#if mode === 'onpremise'}
        <DownloadToggle {track} size={26} />
      {:else}
        <span></span>
      {/if}
      <button class="icon-btn" aria-label="Coda di riproduzione" onclick={() => (ui.queueOpen = true)}>
        <Icon name="queue" />
      </button>
    </div>
  </div>
{/if}

<style>
  .full {
    position: fixed;
    inset: 0;
    z-index: var(--z-fullplayer);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: calc(var(--safe-top) + var(--space-2)) var(--space-5) calc(var(--safe-bottom) + var(--space-5));
    background:
      radial-gradient(120% 60% at 50% 0%, color-mix(in srgb, var(--tint) 65%, transparent) 0%, transparent 70%),
      linear-gradient(180deg, color-mix(in srgb, var(--tint) 55%, var(--bg)) 0%, var(--bg) 78%);
    animation: slide-up 0.32s var(--ease-out);
    touch-action: none;
    overflow: hidden;
  }
  .full:not(.dragging) {
    transition: transform 0.25s var(--ease-out);
  }
  @keyframes slide-up {
    from {
      transform: translateY(100%);
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  header .icon-btn {
    color: var(--text);
  }
  .context {
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .art {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
  }
  .art > :global(.cover) {
    width: min(100%, 52vh) !important;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .names {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .names :global(.title) {
    font-size: var(--fs-xl);
    font-weight: 700;
  }
  .artist {
    color: var(--text-2);
  }
  .fav.on,
  .icon-btn.on {
    color: var(--accent);
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .controls .icon-btn {
    color: var(--text);
  }
  .controls .icon-btn.on {
    color: var(--accent);
  }
  .big {
    width: 56px;
    height: 56px;
  }
  .play {
    display: grid;
    place-items: center;
    width: 68px;
    height: 68px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
  }
  .play:active {
    transform: scale(0.95);
  }
  .extras {
    display: flex;
    justify-content: space-between;
  }
  @media (prefers-reduced-motion: reduce) {
    .full {
      animation: none;
    }
  }
</style>
