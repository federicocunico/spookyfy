<script lang="ts">
import Icon from '../components/Icon.svelte';
import { formatBytes, pluralize } from '../lib/format';
import { pathOf } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';

const { session, storage, downloads, router, toasts } = services();
let busy = $state(false);

$effect(() => {
  void storage.refresh();
});

async function logout() {
  busy = true;
  try {
    await session.logout();
    router.navigate(pathOf.login(), { replace: true });
  } catch {
    toasts.error('Uscita non riuscita');
  } finally {
    busy = false;
  }
}
</script>

<div class="page">
  <header class="top">
    <button class="icon-btn" aria-label="Indietro" onclick={() => router.back('/library')}>
      <Icon name="chevron-left" size={28} />
    </button>
    <h1 class="page-title">Impostazioni</h1>
  </header>

  <section class="card">
    <h2>Account</h2>
    <p>Connesso come <strong>{session.user?.username}</strong></p>
    {#if session.offlineMode}<p class="muted small">Modalità offline: il server non è raggiungibile.</p>{/if}
    <button class="btn btn-secondary" onclick={logout} disabled={busy}>
      <Icon name="logout" size={18} /> Esci
    </button>
  </section>

  <section class="card" aria-labelledby="storage-title">
    <h2 id="storage-title">Spazio sul dispositivo</h2>
    {#if storage.persisted === true}
      <p class="status ok" data-testid="storage-status">Storage protetto</p>
      <p class="muted small">Il sistema non eliminerà i brani scaricati quando lo spazio scarseggia.</p>
    {:else if storage.persisted === false}
      <p class="status warn" data-testid="storage-status">Storage non protetto</p>
      <p class="muted small">
        Con poco spazio il sistema potrebbe eliminare i brani scaricati; in quel caso verranno riprodotti in
        streaming. Su iPhone, installa l'app nella schermata Home per proteggerli.
      </p>
    {:else}
      <p class="muted small" data-testid="storage-status">Verifica in corso…</p>
    {/if}
    <dl>
      <div><dt>Brani scaricati</dt><dd>{pluralize(downloads.downloadedCount, 'brano', 'brani')}</dd></div>
      {#if storage.usage !== null}
        <div><dt>Usato da Spookyfy</dt><dd data-testid="storage-usage">{formatBytes(storage.usage)}</dd></div>
      {/if}
      {#if storage.quota !== null && storage.usage !== null}
        <div>
          <dt>Disponibile</dt><dd data-testid="storage-free">{formatBytes(Math.max(0, storage.quota - storage.usage))}</dd>
        </div>
      {/if}
    </dl>
  </section>

  <p class="muted small version">Spookyfy {import.meta.env.VITE_APP_VERSION ?? '0.1.0'}</p>
</div>

<style>
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: calc(-1 * var(--space-2));
  }
  .top .page-title {
    margin: 0;
  }
  .card {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
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
  .status {
    font-weight: 700;
  }
  .ok {
    color: var(--accent);
  }
  .warn {
    color: var(--danger);
  }
  dl {
    width: 100%;
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }
  dl div {
    display: flex;
    justify-content: space-between;
    font-size: var(--fs-s);
  }
  dt {
    color: var(--text-2);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .version {
    margin-top: var(--space-6);
    text-align: center;
  }
</style>
