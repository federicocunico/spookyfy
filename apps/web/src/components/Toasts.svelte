<script lang="ts">
import { services } from '../lib/services.svelte';

const { toasts, player } = services();
</script>

<div class="toasts" class:raised={player.current !== null} aria-live="polite">
  {#each toasts.items as t (t.id)}
    <div class="toast" class:error={t.kind === 'error'} role={t.kind === 'error' ? 'alert' : 'status'}>
      <span>{t.message}</span>
      {#if t.action}
        <button
          onclick={() => {
            t.action?.run();
            toasts.dismiss(t.id);
          }}>{t.action.label}</button
        >
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: var(--space-3);
    right: var(--space-3);
    bottom: calc(var(--tabbar-h) + var(--safe-bottom) + var(--space-3));
    z-index: var(--z-toast);
    display: grid;
    gap: var(--space-2);
    pointer-events: none;
  }
  .raised {
    bottom: calc(var(--tabbar-h) + var(--miniplayer-h) + var(--safe-bottom) + var(--space-3));
  }
  .toast {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-m);
    background: #f5f3fa;
    color: #0b0a10;
    font-size: var(--fs-s);
    font-weight: 600;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    animation: pop 0.2s var(--ease-out);
  }
  .toast.error {
    background: #ffd7d7;
  }
  button {
    font-weight: 800;
    color: #0b0a10;
  }
  @keyframes pop {
    from {
      transform: translateY(8px);
      opacity: 0;
    }
  }
</style>
