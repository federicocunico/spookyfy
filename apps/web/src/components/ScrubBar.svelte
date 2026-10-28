<script lang="ts">
import { formatTime } from '../lib/format';

/**
 * Barra di avanzamento spessa e facile da toccare (area ≥ 44 px): durante il
 * trascinamento mostra il tempo di destinazione e sposta l'audio solo al rilascio.
 */
let {
  position,
  duration,
  onseek,
}: { position: number; duration: number; onseek: (seconds: number) => void } = $props();

let el: HTMLElement | undefined = $state();
let dragging = $state<number | null>(null);
const shown = $derived(dragging ?? position);
const fraction = $derived(duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0);

function timeAt(clientX: number): number {
  const rect = el!.getBoundingClientRect();
  const f = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  return Math.min(1, Math.max(0, f)) * duration;
}
function onpointerdown(e: PointerEvent) {
  if (!duration) return;
  el?.setPointerCapture?.(e.pointerId);
  dragging = timeAt(e.clientX);
}
function onpointermove(e: PointerEvent) {
  if (dragging !== null) dragging = timeAt(e.clientX);
}
function onpointerup(e: PointerEvent) {
  if (dragging === null) return;
  const t = timeAt(e.clientX);
  dragging = null;
  onseek(t);
}
function onkeydown(e: KeyboardEvent) {
  const step = e.shiftKey ? 15 : 5;
  if (e.key === 'ArrowRight') onseek(Math.min(duration, position + step));
  else if (e.key === 'ArrowLeft') onseek(Math.max(0, position - step));
  else return;
  e.preventDefault();
}
</script>

<div class="scrub">
  <div
    class="hit"
    bind:this={el}
    role="slider"
    tabindex="0"
    aria-label="Posizione nel brano"
    aria-valuemin={0}
    aria-valuemax={Math.round(duration)}
    aria-valuenow={Math.round(shown)}
    aria-valuetext={`${formatTime(shown)} di ${formatTime(duration)}`}
    class:dragging={dragging !== null}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointercancel={() => (dragging = null)}
    {onkeydown}
    data-testid="scrub"
  >
    <div class="rail"><div class="fill" style:width={`${fraction * 100}%`}></div></div>
    <div class="thumb" style:left={`${fraction * 100}%`}></div>
  </div>
  <div class="times">
    <span data-testid="elapsed">{formatTime(shown)}</span>
    <span data-testid="remaining">-{formatTime(Math.max(0, duration - shown))}</span>
  </div>
</div>

<style>
  .hit {
    position: relative;
    height: 44px;
    display: flex;
    align-items: center;
    touch-action: none;
    cursor: pointer;
  }
  .rail {
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.25);
    overflow: hidden;
    transition: height 0.15s ease;
  }
  .dragging .rail {
    height: 6px;
  }
  .fill {
    height: 100%;
    background: var(--text);
  }
  .dragging .fill {
    background: var(--accent);
  }
  .thumb {
    position: absolute;
    top: 50%;
    width: 14px;
    height: 14px;
    margin-left: -7px;
    margin-top: -7px;
    border-radius: 50%;
    background: var(--text);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    transition: transform 0.15s ease;
  }
  .dragging .thumb {
    transform: scale(1.3);
  }
  .times {
    display: flex;
    justify-content: space-between;
    margin-top: -6px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
</style>
