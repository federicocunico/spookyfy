<script lang="ts">
import { type AlbumSummaryDto, ErrorCode, type RemoteSearchResultDto, type TrackDto } from '@spookyfy/shared';
import Cover from '../components/Cover.svelte';
import Icon from '../components/Icon.svelte';
import ImportFilesButton from '../components/ImportFilesButton.svelte';
import RemoteResult from '../components/RemoteResult.svelte';
import TrackRow from '../components/TrackRow.svelte';
import { ApiError } from '../lib/api';
import { searchViaBridge } from '../lib/device/backend';
import { pathOf } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';

const LOCAL_DEBOUNCE_MS = 200;
const { api, player, connection, mode, device, router } = services();

let query = $state('');
let local = $state<TrackDto[] | null>(null);
let localAlbums = $state<AlbumSummaryDto[]>([]);
let remote = $state<RemoteSearchResultDto[] | null>(null);
let remoteError = $state<string | null>(null);
let remoteLoading = $state(false);
let remoteFor = $state('');
let remoteErrorCode = $state<string | null>(null);
/** Risultati ottenuti tramite il server di casa (modalità client, gateway bloccato). */
let via = $state<'gateway' | 'bridge'>('gateway');
let bridgeAvailable = $state(false);

$effect(() => {
  if (!device) return;
  void device.bridge().then((b) => {
    bridgeAvailable = b !== null;
  });
});

// Ricerca locale immediata (con debounce) mentre si digita.
$effect(() => {
  const q = query.trim();
  if (!q) {
    local = null;
    localAlbums = [];
    return;
  }
  const ac = new AbortController();
  const timer = setTimeout(async () => {
    try {
      local = (await api.tracks.list({ q, limit: 20 }, ac.signal)).items;
    } catch (err) {
      if ((err as Error).name !== 'AbortError') local = [];
    }
    // Album per titolo o artista (solo quelli: i brani sono già sopra).
    const albums = await api.albums.list('title', q).catch(() => ({ items: [] }));
    if (!ac.signal.aborted) localAlbums = albums.items.slice(0, 10);
  }, LOCAL_DEBOUNCE_MS);
  return () => {
    clearTimeout(timer);
    ac.abort();
  };
});

async function searchRemote(e?: SubmitEvent) {
  e?.preventDefault();
  const q = query.trim();
  if (!q || connection.offline) return;
  (document.activeElement as HTMLElement | null)?.blur();
  remoteLoading = true;
  remoteError = null;
  remoteErrorCode = null;
  remoteFor = q;
  via = 'gateway';
  try {
    remote = (await api.remote.search(q)).items;
  } catch (err) {
    remote = null;
    remoteError = err instanceof ApiError ? err.message : 'Ricerca non riuscita';
    remoteErrorCode = err instanceof ApiError ? err.code : null;
  } finally {
    remoteLoading = false;
  }
}

async function searchBridge() {
  const bridge = await device?.bridge();
  if (!bridge || !device) return;
  remoteLoading = true;
  try {
    remote = await searchViaBridge(bridge, device.library, query.trim());
    remoteError = null;
    remoteErrorCode = null;
    via = 'bridge';
  } catch (err) {
    remoteError = err instanceof ApiError ? err.message : 'Il server di casa non risponde';
  } finally {
    remoteLoading = false;
  }
}
</script>

<div class="page">
  <h1 class="page-title">Cerca</h1>
  <form class="search" role="search" onsubmit={searchRemote}>
    <span class="icon"><Icon name="search" size={20} /></span>
    <input
      class="input"
      type="search"
      placeholder="Brani o artisti"
      aria-label="Cerca brani o artisti"
      enterkeyhint="search"
      autocomplete="off"
      maxlength="200"
      bind:value={query}
    />
  </form>

  {#if localAlbums.length > 0}
    <h2 class="section-title">Album</h2>
    <ul class="albums" aria-label="Album trovati">
      {#each localAlbums as a (a.id)}
        <li>
          <a
            href={pathOf.album(a.id)}
            onclick={(e) => {
              e.preventDefault();
              router.navigate(pathOf.album(a.id));
            }}
          >
            <Cover src={a.coverThumbUrl} color={a.dominantColor} alt="" />
            <span class="name ellipsis">{a.title}</span>
            <span class="muted sub ellipsis">{a.artist}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  {#if local && local.length > 0}
    <h2 class="section-title">Nella tua libreria</h2>
    {#each local as t, i (t.id)}
      <TrackRow track={t} onplay={() => player.playTracks(local ?? [], i, 'search')} />
    {/each}
  {:else if local && query.trim()}
    <p class="muted none">Nessun brano in libreria per «{query.trim()}».</p>
  {/if}

  {#if query.trim()}
    <section class="remote" aria-labelledby="remote-title">
      <h2 id="remote-title" class="section-title">Da YouTube</h2>
      {#if connection.offline}
        <p class="muted" data-testid="remote-unavailable">La ricerca su YouTube non è disponibile offline.</p>
      {:else if remoteFor !== query.trim() || (!remote && !remoteError)}
        <button class="btn btn-secondary" onclick={() => searchRemote()} disabled={remoteLoading}>
          {remoteLoading ? 'Ricerca in corso…' : `Cerca «${query.trim()}» su YouTube`}
        </button>
      {:else if remoteLoading}
        <p class="muted">Ricerca in corso…</p>
      {:else if remoteError}
        <p class="field-error" role="alert">{remoteError}</p>
        {#if mode === 'client' && remoteErrorCode === ErrorCode.YoutubeBlocked}
          <div class="alternatives" data-testid="search-alternatives">
            <ImportFilesButton />
            {#if bridgeAvailable}
              <button class="btn btn-secondary" onclick={searchBridge}>Cerca tramite il server di casa</button>
            {/if}
          </div>
        {/if}
        <button class="btn btn-secondary retry" onclick={() => searchRemote()}>Riprova</button>
      {:else if remote && remote.length === 0}
        <p class="muted">Nessun risultato.</p>
      {:else if remote}
        {#each remote as r (r.sourceId)}
          <RemoteResult result={r} {via} {bridgeAvailable} />
        {/each}
      {/if}
    </section>
  {:else}
    <p class="muted hint">Cerca nella tua libreria mentre scrivi; premi Invio per cercare anche su YouTube e aggiungere nuovi brani.</p>
  {/if}
</div>

<style>
  .alternatives {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-3) 0;
  }
  .search {
    position: relative;
  }
  .search .icon {
    position: absolute;
    left: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-2);
    pointer-events: none;
  }
  .search .input {
    padding-left: 44px;
    background: var(--text);
    color: var(--bg);
    border: 0;
    font-weight: 600;
  }
  .search .input::placeholder {
    color: #5c5670;
  }
  .none,
  .hint {
    margin-top: var(--space-4);
    font-size: var(--fs-s);
  }
  .retry {
    margin-top: var(--space-3);
  }
  .albums {
    list-style: none;
    margin: 0 0 var(--space-4);
    padding: 0;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 120px;
    gap: var(--space-3);
    overflow-x: auto;
  }
  .albums a {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .albums .name {
    font-weight: 600;
  }
  .albums .sub {
    font-size: var(--fs-s);
  }
</style>
