<script lang="ts">
import { untrack } from 'svelte';
import { ApiError } from '../lib/api';
import {
  BackupError,
  deliverFiles,
  exportBackup,
  getSettings,
  importBackup,
  patchSettings,
  planBackup,
} from '../lib/device/backup';
import { BridgeClient } from '../lib/device/remote';
import { formatBytes, pluralize } from '../lib/format';
import type { DeviceSettings } from '../lib/offline/db';
import { services } from '../lib/services.svelte';

/** Impostazioni della modalità client: spazio sul dispositivo, backup e ponte on-premise. */
const s = services();
const { storage, toasts, db, library } = s;
const device = s.device!;

let settings = $state<DeviceSettings | null>(null);
let usage = $state(device.library.usage());
let busy = $state<string | null>(null);
let backupInput: HTMLInputElement | undefined = $state();
let bridgeUrl = $state('');
let bridgeToken = $state('');
let bridgeStatus = $state<{ ok: boolean; message: string } | null>(null);

async function refresh() {
  settings = await getSettings(await db());
  bridgeUrl = settings.bridge?.url ?? '';
  bridgeToken = settings.bridge?.token ?? '';
  // Dopo un ricaricamento la libreria locale potrebbe non essere ancora in memoria.
  await device.library.ready();
  usage = device.library.usage();
  await storage.refresh();
}
$effect(() => {
  untrack(() => {
    void refresh();
  });
});

const free = $derived(
  storage.quota !== null && storage.usage !== null ? Math.max(0, storage.quota - storage.usage) : null,
);
const tracksForPlan = $derived(usage.count);

async function doExport(includeAudio: boolean) {
  busy = includeAudio ? 'export-full' : 'export-light';
  try {
    const snap = await device.library.snapshot();
    const plan = planBackup(snap.tracks, includeAudio);
    if (includeAudio)
      toasts.show(
        `Backup di ${formatBytes(plan.audioBytes)} in ${pluralize(plan.parts + 1, 'file', 'file')}…`,
      );
    const files = await exportBackup({ db, library: device.library }, includeAudio);
    await deliverFiles(files);
    await refresh();
    toasts.show('Backup esportato');
  } catch {
    toasts.error('Esportazione non riuscita');
  } finally {
    busy = null;
  }
}

async function doImport() {
  const files = [...(backupInput?.files ?? [])];
  if (files.length === 0) return;
  busy = 'import';
  try {
    const r = await importBackup({ db, library: device.library }, files);
    toasts.show(
      `Backup importato: ${pluralize(r.added, 'brano aggiunto', 'brani aggiunti')}${r.missingAudio ? `, ${r.missingAudio} da riscaricare` : ''}${r.skipped ? `, ${r.skipped} già presenti` : ''}`,
    );
    device.lost.ids = device.library.lostTracks().map((t) => t.id);
    void library.loadHome().catch(() => {});
    void library.loadPlaylists().catch(() => {});
    await refresh();
  } catch (err) {
    toasts.error(err instanceof BackupError ? err.message : 'Il file scelto non è un backup valido');
  } finally {
    busy = null;
    if (backupInput) backupInput.value = '';
  }
}

async function saveBridge(e: SubmitEvent) {
  e.preventDefault();
  bridgeStatus = null;
  const url = bridgeUrl.trim();
  const token = bridgeToken.trim();
  if (!url && !token) {
    await patchSettings(await db(), { bridge: null });
    bridgeStatus = { ok: true, message: 'Ponte disattivato' };
    return;
  }
  busy = 'bridge';
  try {
    const client = new BridgeClient({ url, token });
    await client.check();
    await patchSettings(await db(), { bridge: { url: new URL(url).origin, token } });
    bridgeStatus = { ok: true, message: 'Ponte attivo: puoi cercare e importare tramite il server di casa' };
  } catch (err) {
    bridgeStatus = {
      ok: false,
      message: err instanceof ApiError ? err.message : 'Indirizzo non valido o server non raggiungibile',
    };
  } finally {
    busy = null;
  }
}
</script>

<section class="card" aria-labelledby="device-storage-title">
  <h2 id="device-storage-title">Spazio sul dispositivo</h2>
  {#if storage.persisted === false}
    <p class="warn" data-testid="client-storage-warning">
      La libreria esiste solo su questo telefono e il sistema potrebbe cancellarla quando lo spazio scarseggia.
      Installa l'app nella schermata Home e fai spesso un backup.
    </p>
  {:else if storage.persisted === true}
    <p class="ok" data-testid="storage-status">Storage protetto</p>
  {/if}
  <dl>
    <div><dt>Brani</dt><dd data-testid="device-count">{usage.count}</dd></div>
    <div><dt>Occupato dalla libreria</dt><dd data-testid="device-usage">{formatBytes(usage.bytes)}</dd></div>
    {#if free !== null}<div><dt>Disponibile</dt><dd data-testid="device-free">{formatBytes(free)}</dd></div>{/if}
  </dl>
</section>

<section class="card" aria-labelledby="backup-title">
  <h2 id="backup-title">Backup</h2>
  <p class="muted small" data-testid="last-backup">
    {settings?.lastBackupAt
      ? `Ultimo backup: ${new Date(settings.lastBackupAt).toLocaleDateString('it')}`
      : 'Nessun backup finora.'}
    {settings?.addedSinceBackup ? ` ${pluralize(settings.addedSinceBackup, 'brano aggiunto', 'brani aggiunti')} da allora.` : ''}
  </p>
  <div class="buttons">
    <button class="btn btn-primary" disabled={busy !== null || tracksForPlan === 0} onclick={() => doExport(false)}>
      Esporta (senza audio)
    </button>
    <button class="btn btn-secondary" disabled={busy !== null || tracksForPlan === 0} onclick={() => doExport(true)}>
      Esporta con audio ({formatBytes(usage.bytes)})
    </button>
    <button class="btn btn-secondary" disabled={busy !== null} onclick={() => backupInput?.click()}>Importa backup</button>
  </div>
  <p class="muted small">
    Il backup con audio è diviso in parti da 300 MB. Su iPhone scegli «Salva su File» per conservarlo su iCloud Drive.
  </p>
  <input
    bind:this={backupInput}
    type="file"
    accept=".zip,application/zip"
    multiple
    class="visually-hidden"
    tabindex="-1"
    aria-hidden="true"
    data-testid="backup-input"
    onchange={doImport}
  />
</section>

<section class="card" aria-labelledby="bridge-title">
  <h2 id="bridge-title">Server di casa (ponte)</h2>
  <p class="muted small">
    Se YouTube blocca il gateway, puoi cercare e importare tramite un server Spookyfy on-premise. Crea un token di accesso
    nelle sue impostazioni e autorizza questa origine (BRIDGE_ALLOWED_ORIGINS).
  </p>
  <form onsubmit={saveBridge} novalidate>
    <div class="field">
      <label for="bridge-url">Indirizzo del server</label>
      <input id="bridge-url" class="input" type="url" placeholder="https://spookyfy.example.com" bind:value={bridgeUrl} />
    </div>
    <div class="field">
      <label for="bridge-token">Token di accesso</label>
      <input id="bridge-token" class="input" autocomplete="off" spellcheck="false" bind:value={bridgeToken} />
    </div>
    {#if bridgeStatus}
      <p class={bridgeStatus.ok ? 'ok' : 'field-error'} role="status" data-testid="bridge-status">{bridgeStatus.message}</p>
    {/if}
    <button class="btn btn-secondary" type="submit" disabled={busy !== null}>Verifica e salva</button>
  </form>
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
  .ok {
    color: var(--accent);
    font-weight: 700;
  }
  .warn {
    color: var(--danger);
    font-size: var(--fs-s);
    font-weight: 600;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  dl {
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
</style>
