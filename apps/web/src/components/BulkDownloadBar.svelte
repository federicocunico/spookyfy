<script lang="ts">
import { services } from '../lib/services.svelte';
import Icon from './Icon.svelte';

/**
 * Avanzamento del download di playlist. La modalità "schermo scuro" mostra solo
 * l'avanzamento su nero puro: le API web non regolano la luminosità, ma su OLED
 * il nero è l'equivalente pratico della luminosità minima.
 */
const { downloads } = services();
const bulk = $derived(downloads.bulk);
const pct = $derived(bulk && bulk.total > 0 ? Math.round((bulk.done / bulk.total) * 100) : 0);
</script>

{#if bulk}
  {#if bulk.dim}
    <div
      class="dim"
      role="button"
      tabindex="0"
      aria-label="Esci dalla modalità schermo scuro"
      onclick={() => downloads.setDim(false)}
      onkeydown={(e) => e.key === 'Enter' && downloads.setDim(false)}
      data-testid="dim-overlay"
    >
      <p class="big">{bulk.done} / {bulk.total}</p>
      <p>Download in corso — tocca per tornare all'app</p>
    </div>
  {:else}
    <div class="bar" role="status" data-testid="bulk-bar">
      <div class="info">
        <strong>Download {bulk.done} di {bulk.total}</strong>
        <span class="muted ellipsis">{bulk.currentTitle ?? 'In preparazione…'}</span>
        {#if downloads.wakeLockUnsupported}
          <span class="warn">Tieni lo schermo acceso fino al termine</span>
        {/if}
      </div>
      <button class="icon-btn" aria-label="Modalità schermo scuro" onclick={() => downloads.setDim(true)}>
        <Icon name="moon" size={20} />
      </button>
      <button class="icon-btn" aria-label="Annulla download" onclick={() => void downloads.cancelBulk()}>
        <Icon name="close" size={20} />
      </button>
      <div class="progress" aria-hidden="true"><div style:width={`${pct}%`}></div></div>
    </div>
  {/if}
{/if}

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: var(--z-toast);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: calc(var(--safe-top) + var(--space-2)) var(--space-3) var(--space-2) var(--space-4);
    background: var(--surface-3);
    font-size: var(--fs-s);
  }
  .info {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .warn {
    color: var(--accent);
    font-size: var(--fs-xs);
  }
  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
  }
  .progress div {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s ease;
  }
  .dim {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    display: grid;
    place-content: center;
    gap: var(--space-2);
    background: #000;
    color: #5a5a5a;
    text-align: center;
    font-size: var(--fs-s);
  }
  .big {
    font-size: var(--fs-xxl);
    font-variant-numeric: tabular-nums;
  }
</style>
