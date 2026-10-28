<script lang="ts">
import { untrack } from 'svelte';
import { ApiError } from '../lib/api';
import { services } from '../lib/services.svelte';
import { type AccessTokenDto, type TokensApi, tokensApi } from '../lib/tokens-api';

/** Token di accesso personali (on-premise): permettono a un'app in modalità client di usare il server come ponte. */
let { client = tokensApi }: { client?: TokensApi } = $props();
const { toasts, ui } = services();

let items = $state<AccessTokenDto[] | null>(null);
let name = $state('');
let created = $state<{ name: string; token: string } | null>(null);
let error = $state<string | null>(null);

async function load() {
  try {
    items = (await client.list()).items;
  } catch {
    items = [];
  }
}
$effect(() => {
  untrack(() => {
    void load();
  });
});

async function create(e: SubmitEvent) {
  e.preventDefault();
  error = null;
  try {
    const t = await client.create(name.trim());
    created = { name: t.name, token: t.token };
    name = '';
    await load();
  } catch (err) {
    error = err instanceof ApiError ? err.message : 'Token non creato';
  }
}

async function copy() {
  if (!created) return;
  try {
    await navigator.clipboard.writeText(created.token);
    toasts.show('Token copiato');
  } catch {
    toasts.error('Copia non riuscita: selezionalo e copialo a mano');
  }
}

function revoke(t: AccessTokenDto) {
  ui.confirm = {
    title: 'Revocare il token?',
    message: `Le app che usano «${t.name}» non potranno più importare tramite questo server.`,
    confirmLabel: 'Revoca',
    danger: true,
    confirm: async () => {
      await client.revoke(t.id);
      await load();
    },
  };
}
</script>

<section class="card" aria-labelledby="tokens-title" data-testid="tokens-section">
  <h2 id="tokens-title">Token di accesso</h2>
  <p class="muted small">
    Servono a un'app Spookyfy in modalità client (su Vercel) per importare brani tramite questo server.
  </p>
  {#if created}
    <div class="created" role="status">
      <p>Token «{created.name}»: copialo ora, non verrà più mostrato.</p>
      <code data-testid="new-token">{created.token}</code>
      <div class="row">
        <button class="btn btn-secondary" onclick={copy}>Copia</button>
        <button class="btn btn-secondary" onclick={() => (created = null)}>Fatto</button>
      </div>
    </div>
  {/if}
  <form onsubmit={create} class="row">
    <input class="input" aria-label="Nome del token" placeholder="es. iPhone client" maxlength="60" bind:value={name} />
    <button class="btn btn-primary" type="submit" disabled={!name.trim()}>Crea</button>
  </form>
  {#if error}<p class="field-error" role="alert">{error}</p>{/if}
  {#if items && items.length > 0}
    <ul>
      {#each items as t (t.id)}
        <li>
          <span class="names">
            <strong>{t.name}</strong>
            <span class="muted small">
              creato il {new Date(t.createdAt).toLocaleDateString('it')} · {t.lastUsedAt
                ? `usato il ${new Date(t.lastUsedAt).toLocaleDateString('it')}`
                : 'mai usato'}
            </span>
          </span>
          <button class="btn btn-secondary" onclick={() => revoke(t)} aria-label={`Revoca ${t.name}`}>Revoca</button>
        </li>
      {/each}
    </ul>
  {:else if items}
    <p class="muted small">Nessun token.</p>
  {/if}
</section>

<style>
  .card {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-5);
    padding: var(--space-4);
    border-radius: var(--radius-l);
    background: var(--surface-1);
  }
  h2 {
    font-size: var(--fs-l);
    font-weight: 700;
  }
  .small {
    font-size: var(--fs-s);
  }
  .row {
    display: flex;
    gap: var(--space-2);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .names {
    display: grid;
  }
  .created {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-m);
    background: var(--surface-3);
  }
  code {
    overflow-wrap: anywhere;
    user-select: all;
    -webkit-user-select: all;
    font-size: var(--fs-s);
  }
</style>
