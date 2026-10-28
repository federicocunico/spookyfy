<script lang="ts">
import type { Snippet } from 'svelte';

/** Pannello che sale dal basso, con sfondo oscurato; Esc o tocco fuori lo chiude. */
let { label, onclose, children }: { label: string; onclose: () => void; children: Snippet } = $props();

let panel: HTMLElement | undefined = $state();
$effect(() => {
  const prev = document.activeElement as HTMLElement | null;
  panel?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus();
  return () => prev?.focus?.();
});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" role="presentation" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label={label} bind:this={panel}>
  <div class="handle" aria-hidden="true"></div>
  {@render children()}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-sheet);
    background: var(--scrim);
    animation: fade 0.2s ease;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-sheet);
    max-height: 85dvh;
    overflow-y: auto;
    padding: var(--space-2) var(--space-4) calc(var(--safe-bottom) + var(--space-4));
    background: var(--surface-3);
    border-radius: var(--radius-l) var(--radius-l) 0 0;
    animation: up 0.25s var(--ease-out);
  }
  .handle {
    width: 36px;
    height: 4px;
    margin: 0 auto var(--space-3);
    border-radius: 2px;
    background: var(--text-3);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes up {
    from {
      transform: translateY(100%);
    }
  }
</style>
