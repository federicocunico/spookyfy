<script lang="ts">
/** Righe segnaposto con la stessa altezza delle righe vere: nessuno spostamento al caricamento. */
let { rows = 6, kind = 'row' }: { rows?: number; kind?: 'row' | 'card' } = $props();
</script>

<div class={kind === 'card' ? 'cards' : 'rows'} aria-hidden="true" data-testid="skeleton">
  {#each Array.from({ length: rows }) as _, i (i)}
    {#if kind === 'card'}
      <div class="card"><div class="art shimmer"></div><div class="line shimmer"></div></div>
    {:else}
      <div class="row">
        <div class="thumb shimmer"></div>
        <div class="lines"><div class="line shimmer"></div><div class="line short shimmer"></div></div>
      </div>
    {/if}
  {/each}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: var(--row-h);
  }
  .thumb {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-s);
  }
  .lines {
    flex: 1;
    display: grid;
    gap: var(--space-2);
  }
  .line {
    height: 12px;
    border-radius: var(--radius-pill);
    width: 70%;
  }
  .line.short {
    width: 40%;
  }
  .cards {
    display: flex;
    gap: var(--space-3);
    overflow: hidden;
  }
  .card {
    width: 140px;
    flex: none;
    display: grid;
    gap: var(--space-2);
  }
  .art {
    aspect-ratio: 1;
    border-radius: var(--radius-m);
  }
  .shimmer {
    background: linear-gradient(90deg, var(--surface-2) 0%, var(--surface-3) 50%, var(--surface-2) 100%);
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }
  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }
</style>
