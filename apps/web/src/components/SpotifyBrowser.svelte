<script lang="ts">
import type {
  SpotifyDetailDto,
  SpotifyEntityDto,
  SpotifyEntityKind,
  SpotifyPageDto,
  SpotifyPlaylistItemDto,
  SpotifyPlaylistItemsDto,
  SpotifyTrackDto,
} from '@spookyfy/shared';
import { services } from '../lib/services.svelte';
let { search = false }: { search?: boolean } = $props();
const { spotify, hybrid, toasts, ui } = services();
let query = $state('');
let kind = $state<SpotifyEntityKind>('track');
let libraryType = $state('playlists');
let items = $state<SpotifyEntityDto[]>([]);
let nextOffset = $state<number | null>(null);
let loading = $state(false);
let error = $state('');
let detail = $state<SpotifyDetailDto | null>(null);
let playlistItems = $state<SpotifyPlaylistItemDto[]>([]);
let detailItems = $state<SpotifyEntityDto[]>([]);
let detailNext = $state<number | null>(null);
let serial = 0;
let abort: AbortController | null = null;
let name = $state('');
let description = $state('');
let descriptionChanged = $state(false);
let publicPlaylist = $state(false);
let chosenPlaylist = $state('');
let nativeChoices = $state<SpotifyEntityDto[]>([]);
let trackQuery = $state('');
let trackChoices = $state<SpotifyEntityDto[]>([]);
let trackOffset = $state<number | null>(null);
let trackSearchAbort: AbortController | null = null;
let mutationBusy = $state(false);
let hybridId = $state('');
let hybridChoices = $state<{ id: string; name: string }[]>([]);
let visibilityChanged = $state(false);

async function load(more = false) {
  const request = ++serial;
  abort?.abort();
  abort = new AbortController();
  loading = true;
  error = '';
  if (!more) {
    items = [];
    detail = null;
  }
  try {
    const page = await spotify.api.request<SpotifyPageDto>(
      search ? 'search' : 'library',
      'GET',
      undefined,
      search
        ? { q: query.trim(), type: kind, offset: more ? (nextOffset ?? 0) : 0, limit: 10 }
        : { type: libraryType, offset: more ? (nextOffset ?? 0) : 0, limit: 20 },
      abort.signal,
    );
    if (request !== serial) return;
    items = more
      ? [...items, ...page.items.filter((item) => !items.some((old) => old.uri === item.uri))]
      : page.items;
    nextOffset = page.nextOffset;
  } catch (e) {
    if (request === serial && !abort.signal.aborted)
      error = e instanceof Error ? e.message : 'Spotify non disponibile';
  } finally {
    if (request === serial) loading = false;
  }
}
$effect(() => {
  query;
  kind;
  if (search) {
    serial++;
    abort?.abort();
    items = [];
    nextOffset = null;
    loading = false;
  }
});
$effect(() => () => {
  serial++;
  abort?.abort();
  trackSearchAbort?.abort();
});
$effect(() => {
  trackQuery;
  trackSearchAbort?.abort();
  trackChoices = [];
  trackOffset = null;
});

async function open(entity: SpotifyEntityDto, more = false) {
  const request = ++serial;
  abort?.abort();
  abort = new AbortController();
  loading = true;
  error = '';
  try {
    const response = await spotify.api.request<SpotifyDetailDto>(
      'detail',
      'GET',
      undefined,
      { type: entity.kind, id: entity.id, offset: more ? (detailNext ?? 0) : 0, limit: 20 },
      abort.signal,
    );
    if (request !== serial) return;
    detail = response;
    if (!more) {
      visibilityChanged = false;
      descriptionChanged = false;
      name = response.entity.name;
      description = response.entity.description ?? '';
      publicPlaylist = response.entity.public ?? false;
    }
    if (response.items && 'contentsAvailable' in response.items) {
      playlistItems = more
        ? [...playlistItems, ...(response.items as SpotifyPlaylistItemsDto).items]
        : (response.items as SpotifyPlaylistItemsDto).items;
      detailItems = [];
    } else {
      detailItems = more
        ? [...detailItems, ...((response.items?.items ?? []) as SpotifyEntityDto[])]
        : ((response.items?.items ?? []) as SpotifyEntityDto[]);
      playlistItems = [];
    }
    detailNext = response.items?.nextOffset ?? null;
  } catch (e) {
    if (request === serial && !abort.signal.aborted)
      error = e instanceof Error ? e.message : 'Dettagli non disponibili';
  } finally {
    if (request === serial) loading = false;
  }
}

async function mutate(action: string, method: string, body: unknown) {
  mutationBusy = true;
  error = '';
  try {
    await spotify.api.request(action, method, body);
    if (detail) await open(detail.entity);
    else await load();
  } catch (e) {
    error =
      e instanceof Error ? e.message : 'Modifica Spotify non riuscita'; /* Never retry uncertain writes. */
  } finally {
    mutationBusy = false;
  }
}
function save(item: SpotifyEntityDto, remove = false) {
  return mutate('saved', remove ? 'DELETE' : 'PUT', { uris: [item.uri] });
}
function play(item: SpotifyEntityDto) {
  if (item.kind !== 'track') return;
  const context =
    detail?.entity.kind === 'playlist' || detail?.entity.kind === 'album' ? detail.entity.uri : undefined;
  spotify.play(item as SpotifyTrackDto, context);
}
async function loadCollections() {
  try {
    hybridChoices = await hybrid.list();
  } catch (e) {
    error = (e as Error).message;
  }
}
async function addReference() {
  if (!detail || !spotify.status?.accountId) return;
  try {
    await hybrid.add(hybridId, { provider: 'spotify', uri: detail.entity.uri }, spotify.status.accountId);
    toasts.show('Riferimento Spotify aggiunto alla raccolta');
  } catch (e) {
    error = (e as Error).message;
  }
}
async function loadNativePlaylists() {
  try {
    const choices: SpotifyEntityDto[] = [];
    let offset: number | null = 0;
    // A bounded selector; large libraries can continue through the native library view.
    for (let pages = 0; offset !== null && pages < 10; pages++) {
      const page: SpotifyPageDto = await spotify.api.request('library', 'GET', undefined, {
        type: 'playlists',
        offset,
        limit: 50,
      });
      choices.push(...page.items.filter((item) => item.editable));
      offset = page.nextOffset;
    }
    nativeChoices = choices;
  } catch (e) {
    error = (e as Error).message;
  }
}
async function findTracks(more = false) {
  trackSearchAbort?.abort();
  const ac = new AbortController();
  trackSearchAbort = ac;
  try {
    const page = await spotify.api.request<SpotifyPageDto>(
      'search',
      'GET',
      undefined,
      { q: trackQuery.trim(), type: 'track', offset: more ? (trackOffset ?? 0) : 0, limit: 10 },
      ac.signal,
    );
    if (ac.signal.aborted) return;
    trackChoices = more
      ? [...trackChoices, ...page.items.filter((item) => !trackChoices.some((old) => old.uri === item.uri))]
      : page.items;
    trackOffset = page.nextOffset;
  } catch (e) {
    if (!ac.signal.aborted) error = (e as Error).message;
  }
}
function removeAll(item: SpotifyPlaylistItemDto) {
  if (!item.track || !detail) return;
  const entity = detail.entity;
  const track = item.track;
  ui.confirm = {
    title: 'Rimuovi tutte le occorrenze da Spotify',
    message: `Rimuovere tutte le occorrenze di «${track.name}» dalla playlist «${entity.name}»?`,
    confirmLabel: 'Rimuovi tutte le occorrenze',
    danger: true,
    confirm: () =>
      mutate('playlist-items', 'DELETE', { id: entity.id, uris: [track.uri], snapshotId: entity.snapshotId }),
  };
}
async function copyPlaylist() {
  if (!detail || !spotify.status?.accountId) return;
  const entity = detail.entity;
  mutationBusy = true;
  try {
    const result = await hybrid.copySpotify(entity.name, spotify.status.accountId, (offset) =>
      spotify.api.request<SpotifyPlaylistItemsDto>('playlist-items', 'GET', undefined, {
        id: entity.id,
        offset,
        limit: 50,
      }),
    );
    toasts.show(`Raccolta copiata: ${result.playlist.items.length} riferimenti, ${result.excluded} esclusi`);
  } catch (e) {
    error = (e as Error).message;
  } finally {
    mutationBusy = false;
  }
}
</script>

<section aria-label={search ? 'Ricerca Spotify' : 'Libreria Spotify'} class="spotify-browser">
  <h2 class="section-title">{search ? 'Spotify' : libraryType === 'playlists' ? 'Le tue playlist' : libraryType === 'tracks' ? 'I tuoi brani salvati' : 'I tuoi album salvati'}</h2>
  {#if !spotify.status?.capabilities.canBrowse}
    <p>Collega Spotify e autorizza la lettura dalle <a href="/settings">impostazioni</a>.</p>
  {:else}
    {#if search}
      <form onsubmit={(event) => { event.preventDefault(); void load(); }} role="search" aria-label="Cerca su Spotify">
        <input class="input" type="search" aria-label="Ricerca Spotify" maxlength="200" bind:value={query} />
        <select class="input" aria-label="Tipo risultato Spotify" bind:value={kind}><option value="track">Brani</option><option value="album">Album</option><option value="artist">Artisti</option><option value="playlist">Playlist</option></select>
        <button class="btn btn-secondary" disabled={loading || !query.trim()}>Cerca su Spotify</button>
      </form>
    {:else}
      <select class="input" aria-label="Raccolta Spotify" bind:value={libraryType}><option value="playlists">Playlist</option><option value="tracks">Brani salvati</option><option value="albums">Album salvati</option></select>
      <button class="btn btn-secondary" onclick={() => load()} disabled={loading}>Carica libreria Spotify</button>
      <details><summary>Crea playlist Spotify</summary>
        <input class="input" aria-label="Nome nuova playlist Spotify" bind:value={name} maxlength="100" />
        <label><input type="checkbox" bind:checked={publicPlaylist} /> Pubblica su Spotify</label>
        <button class="btn btn-secondary" disabled={mutationBusy || !name.trim() || !spotify.status.capabilities.canEditPlaylist} onclick={() => mutate('playlist', 'POST', { name, public: publicPlaylist })}>Crea playlist</button>
      </details>
    {/if}
    {#if error}<p role="alert">{error} Le modifiche con esito incerto non vengono ripetute. Aggiorna per verificarne l'esito.</p>{/if}
    {#if loading}<p role="status">Caricamento Spotify…</p>{/if}
    {#if detail}
      <button class="btn btn-secondary" onclick={() => { serial++; abort?.abort(); detail = null; }}>Torna ai risultati Spotify</button>
      <h3>{detail.entity.name}</h3>
      <a href={detail.entity.externalUrl} target="_blank" rel="noopener noreferrer">Apri su Spotify</a>
      {#if detail.entity.kind === 'track' || detail.entity.kind === 'album'}
        <button class="btn btn-secondary" disabled={mutationBusy || !spotify.status.capabilities.canEditLibrary} onclick={() => save(detail!.entity)}>Salva su Spotify</button>
        <button class="btn btn-secondary" disabled={mutationBusy || !spotify.status.capabilities.canEditLibrary} onclick={() => save(detail!.entity, true)}>Rimuovi dai salvati Spotify</button>
      {/if}
      {#if (detail.entity.kind === 'album' || detail.entity.kind === 'playlist') && spotify.status.capabilities.canStream}
        {@const first = detail.entity.kind === 'playlist' ? playlistItems.find((item) => item.track?.available)?.track : detailItems.find((item) => item.kind === 'track' && item.available)}
        <button class="btn btn-secondary" disabled={!first} onclick={() => { if (first) spotify.play(first as SpotifyTrackDto, detail!.entity.uri); }}>Riproduci {detail.entity.kind === 'playlist' ? 'playlist' : 'album'} su Spotify</button>
      {/if}
      {#if detail.entity.kind === 'track'}
        <button class="btn btn-secondary" disabled={!spotify.status.capabilities.canStream} onclick={() => play(detail!.entity)}>Riproduci su Spotify</button>
        <button class="btn btn-secondary" onclick={loadNativePlaylists}>Scegli playlist Spotify</button>
        <select aria-label="Playlist Spotify di destinazione" bind:value={chosenPlaylist}><option value="">Scegli playlist</option>{#each nativeChoices as playlist}<option value={playlist.id}>{playlist.name}</option>{/each}</select>
        <button class="btn btn-secondary" disabled={mutationBusy || !/^[A-Za-z0-9]{22}$/.test(chosenPlaylist) || !spotify.status.capabilities.canEditPlaylist} onclick={() => mutate('playlist-items', 'POST', { id: chosenPlaylist, uris: [detail!.entity.uri] })}>Aggiungi alla playlist Spotify</button>
        <button class="btn btn-secondary" onclick={loadCollections}>Scegli raccolta Spookyfy</button>
        {#if hybridChoices.length}<select aria-label="Raccolta Spookyfy di destinazione" bind:value={hybridId}><option value="">Scegli raccolta</option>{#each hybridChoices as choice}<option value={choice.id}>{choice.name}</option>{/each}</select><button disabled={!hybridId || mutationBusy} onclick={addReference}>Aggiungi riferimento alla raccolta</button>{/if}
      {/if}
      {#if detail.entity.kind === 'playlist'}
        <button class="btn btn-secondary" disabled={mutationBusy || detail.entity.contentsAvailable === false} onclick={copyPlaylist}>Copia riferimenti nella raccolta Spookyfy</button>
        {#if detail.entity.contentsAvailable === false || (detail.items && 'contentsAvailable' in detail.items && !detail.items.contentsAvailable)}<p>Accesso agli elementi limitato. La playlist non è necessariamente vuota.</p>{/if}
        {#if detail.entity.editable}
          <input class="input" aria-label="Nome playlist Spotify" bind:value={name} maxlength="100" />
          <textarea class="input" aria-label="Descrizione playlist Spotify" bind:value={description} oninput={() => { descriptionChanged = true; }} maxlength="300"></textarea>
          <label><input type="checkbox" bind:checked={publicPlaylist} onchange={() => { visibilityChanged = true; }} /> Rendi pubblica su Spotify (solo se modificato)</label>
          <button class="btn btn-secondary" disabled={mutationBusy || !spotify.status.capabilities.canEditPlaylist} onclick={() => mutate('playlist', 'PATCH', { id: detail!.entity.id, name, ...(descriptionChanged ? { description } : {}), ...(visibilityChanged ? { public: publicPlaylist } : {}) })}>Aggiorna metadati Spotify</button>
          <form onsubmit={(event) => { event.preventDefault(); void findTracks(); }}>
            <input class="input" aria-label="Cerca brani da aggiungere alla playlist Spotify" bind:value={trackQuery} maxlength="200" />
            <button class="btn btn-secondary" disabled={mutationBusy || !trackQuery.trim()}>Cerca brani per la playlist</button>
          </form>
          <ul>{#each trackChoices as candidate (candidate.uri)}<li><a href={candidate.externalUrl} target="_blank" rel="noopener noreferrer">{candidate.name} · {candidate.artists.join(', ')} · Spotify</a><button disabled={mutationBusy || !candidate.available} onclick={() => mutate('playlist-items', 'POST', { id: detail!.entity.id, uris: [candidate.uri] })}>Aggiungi {candidate.name} alla playlist Spotify</button></li>{/each}</ul>
          {#if trackOffset !== null}<button onclick={() => findTracks(true)}>Altri brani per la playlist</button>{/if}
        {:else}<p>Playlist Spotify in sola lettura.</p>{/if}
        <ol>{#each playlistItems as item (item.itemId)}<li>
          {#if item.track}<a href={item.track.externalUrl} target="_blank" rel="noopener noreferrer">{item.track.name} — {item.track.artists.join(', ')} · Spotify</a>
            <button disabled={!item.track.available || !spotify.status.capabilities.canStream} onclick={() => play(item.track!)}>Riproduci</button>
          {:else}<span>Elemento {item.position + 1} non disponibile: {item.reason ?? 'Contenuto non supportato'}</span>{/if}
          {#if detail.entity.editable && spotify.status.capabilities.canEditPlaylist}
            <button disabled={mutationBusy || !item.track} onclick={() => removeAll(item)}>Rimuovi tutte le occorrenze di questo brano</button>
            <button disabled={mutationBusy || item.position === 0} onclick={() => mutate('playlist-items', 'PUT', { id: detail!.entity.id, rangeStart: item.position, insertBefore: item.position - 1, rangeLength: 1, snapshotId: detail!.entity.snapshotId })}>Sposta su</button>
          {/if}
        </li>{/each}</ol>
      {/if}
      <ul>{#each detailItems as item (item.uri)}<li><button onclick={() => open(item)}>{item.name}</button> <a href={item.externalUrl} target="_blank" rel="noopener noreferrer">Spotify</a>{#if item.kind === 'track'}<button disabled={!item.available || !spotify.status.capabilities.canStream} onclick={() => play(item)}>Riproduci {item.name} su Spotify</button>{/if}</li>{/each}</ul>
      {#if detailNext !== null}<button class="btn btn-secondary" disabled={loading} onclick={() => open(detail!.entity, true)}>Altri elementi Spotify</button>{/if}
    {:else}
      <ul class="entity-grid" aria-label="Risultati Spotify">
        {#each items as item (item.uri)}
          <li class="entity-card">
            <div class="artwork">
              {#if item.imageUrl}<a class="artwork-link" href={item.externalUrl} target="_blank" rel="noopener noreferrer"><img src={item.imageUrl} alt={`Copertina di ${item.name} su Spotify`} loading="lazy" decoding="async" /></a>
              {:else}<div class="artwork-placeholder" aria-hidden="true">&#9835;</div>{/if}
              <span class="spotify-badge" aria-label="Contenuto da Spotify"><svg class="spotify-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" /><path d="M6.5 9.2c3.8-1.1 7.7-.6 11.2 1.4M7.4 12.3c3.1-.8 6.3-.4 9.1 1.2M8.3 15.2c2.4-.6 4.9-.2 7 1" fill="none" stroke="#1ed760" stroke-width="1.7" stroke-linecap="round" /></svg> Spotify</span>
            </div>
            <button class="entity-main" onclick={() => open(item)} aria-label={`${item.name} ${item.artists.join(', ')}`}>
              <span class="entity-title ellipsis">{item.name}</span>
              <span class="entity-sub ellipsis">{item.kind === 'track' || item.kind === 'album' ? item.artists.join(', ') : item.kind === 'artist' ? 'Artista' : 'Playlist'}{item.trackCount !== undefined ? ` | ${item.trackCount} brani` : ''}</span>
            </button>
            <a class="spotify-link" href={item.externalUrl} target="_blank" rel="noopener noreferrer">Apri su Spotify</a>
          </li>
        {/each}
      </ul>
      {#if nextOffset !== null}<button class="btn btn-secondary" onclick={() => load(true)} disabled={loading}>Altri risultati Spotify</button>{/if}
    {/if}
  {/if}
</section>
<style>
  .spotify-browser { display:grid; gap:var(--space-3); padding-bottom:var(--space-4); }
  form, li:not(.entity-card), details { display:flex; gap:var(--space-2); flex-wrap:wrap; align-items:center; }
  ul, ol { display:grid; gap:var(--space-2); padding:0; list-style:none; }
  button, select { min-height:44px; }
  a { color:var(--accent); }
  .entity-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); gap:var(--space-2); }
  .entity-card { display:grid; align-content:start; gap:var(--space-1); min-width:0; padding:var(--space-2); border-radius:var(--radius-m); background:var(--surface-3); }
  .artwork { position:relative; aspect-ratio:1; overflow:hidden; border-radius:var(--radius-s); background:var(--surface-2); }
  .artwork img, .artwork-placeholder { display:block; width:100%; height:100%; object-fit:cover; }
  .artwork-placeholder { display:grid; place-items:center; color:var(--text-2); font-size:2.5rem; }
  .spotify-badge { position:absolute; top:var(--space-1); right:var(--space-1); display:inline-flex; align-items:center; gap:4px; min-height:24px; padding:0 8px; border-radius:var(--radius-pill); color:#10110f; background:#1ed760; font-size:var(--fs-xs); font-weight:700; box-shadow:0 1px 4px #0008; }
  .spotify-mark { display:block; width:18px; height:18px; color:#10110f; flex:none; }
  .artwork-link { display:block; width:100%; height:100%; }
  .entity-main { display:grid; gap:2px; min-width:0; min-height:52px; padding:var(--space-1) 0; text-align:left; }
  .entity-title { font-size:var(--fs-s); font-weight:700; }
  .entity-sub { color:var(--text-2); font-size:var(--fs-xs); }
  .spotify-link { width:fit-content; font-size:var(--fs-xs); }
  .entity-card:active { background:var(--surface-hover); }
  @media (min-width:640px) { .entity-grid { grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:var(--space-3); } }
  @media (prefers-reduced-motion: no-preference) { .entity-card { transition:background-color 120ms ease; } }
  @media (forced-colors:active) { .spotify-badge { border:1px solid ButtonText; } }
</style>
