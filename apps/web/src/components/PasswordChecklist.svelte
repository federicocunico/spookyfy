<script lang="ts">
import { checkPassword } from '@spookyfy/shared';

let { password, id }: { password: string; id?: string } = $props();
const checks = $derived(checkPassword(password));
</script>

<ul class="checklist" {id} aria-label="Requisiti della password">
  {#each checks as c (c.id)}
    <li class:ok={c.ok} data-requirement={c.id} data-ok={c.ok}>
      <span class="mark" aria-hidden="true">{c.ok ? '✓' : '•'}</span>
      {c.label}
      <span class="visually-hidden">{c.ok ? '(soddisfatto)' : '(mancante)'}</span>
    </li>
  {/each}
</ul>

<style>
  .checklist {
    list-style: none;
    margin: var(--space-1) 0 0;
    padding: 0;
    display: grid;
    gap: 2px;
    font-size: var(--fs-s);
    color: var(--text-2);
  }
  li {
    display: flex;
    gap: var(--space-2);
  }
  .mark {
    width: 1em;
    text-align: center;
  }
  .ok {
    color: var(--text);
  }
  .ok .mark {
    color: var(--accent);
  }
</style>
