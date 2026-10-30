<script lang="ts">
import type { HybridPlaylistDto, HybridPlaylistItemDto } from '@spookyfy/shared';
import { onMount } from 'svelte';
import type { HybridRepositoryApi } from '../lib/hybrid/repository';
let {
  repository,
  accountId = null,
  onplay,
  ondownload,
  onreconcile,
  localTracks = [],
  legacyPlaylists = [],
  remoteLabels = {},
}: {
  repository: HybridRepositoryApi;
  accountId?: string | null;
  onplay?: (playlist: HybridPlaylistDto) => void;
  ondownload?: (playlist: HybridPlaylistDto) => void;
  onreconcile?: () => void;
  localTracks?: { id: string; title: string; artist: string }[];
  legacyPlaylists?: { id: string; name: string }[];
  remoteLabels?: Record<string, string>;
} = $props();
let playlists = $state<HybridPlaylistDto[]>([]);
let name = $state('');
let reference = $state('');
let selected = $state('');
let error = $state('');
async function run(action: () => Promise<unknown>) {
  error = '';
  try {
    await action();
    playlists = await repository.list();
  } catch (e) {
    error = (e as Error).message;
  }
}
function label(item: HybridPlaylistItemDto) {
  if (item.ref.provider === 'spotify')
    return (!item.inert && remoteLabels[item.ref.uri]) || 'Brano Spotify non disponibile';
  const track = localTracks.find((t) => item.ref.provider === 'local' && t.id === item.ref.trackId);
  return track ? `${track.title} - ${track.artist}` : 'File locale mancante';
}
onMount(() => {
  void run(async () => {});
  return repository.subscribe?.(() => {
    void run(async () => {});
  });
});
</script>

<section class="hybrid">
  <h1>Raccolte Spookyfy</h1>
  <p>File locali e brani Spotify, in un ordine scelto da te. Spotify richiede una connessione.</p>
  {#if error}<p role="alert">{error}</p>{/if}
  <form onsubmit={(e) => { e.preventDefault(); void run(async () => { const p = await repository.create(name); selected = p.id; name = ''; }); }}>
    <label>Nome raccolta <input bind:value={name} required maxlength="100" /></label>
    <button type="submit">Crea raccolta</button>
  </form>
  {#if repository.copyLegacy && legacyPlaylists.length}
    <h2>Copia una playlist locale</h2><p>La playlist originale viene conservata.</p>
    {#each legacyPlaylists as p}<button onclick={() => void run(() => repository.copyLegacy!(p.id))}>Copia {p.name}</button>{/each}
  {/if}
  {#if playlists.length && localTracks.length}
    <form onsubmit={(e) => { e.preventDefault(); void run(() => repository.add(selected, { provider: 'local', trackId: reference })); }}>
      <label>Raccolta <select bind:value={selected} required><option value="">Scegli</option>{#each playlists as p}<option value={p.id}>{p.name}</option>{/each}</select></label>
      <label>Brano locale <select bind:value={reference} required><option value="">Scegli un brano</option>{#each localTracks as t}<option value={t.id}>{t.title} - {t.artist}</option>{/each}</select></label>
      <button type="submit">Aggiungi occorrenza</button>
    </form>
  {/if}
  {#if accountId}<p>Aggiungi brani dalla ricerca Spotify scegliendo la raccolta.</p>{/if}
  {#if accountId && onreconcile && playlists.some(p => p.items.some(i => i.ref.provider === 'spotify' && i.inert))}
    <p>I riferimenti ripristinati vengono attivati solo se appartengono allo stesso account Spotify.</p>
    <button onclick={() => onreconcile?.()}>Conferma riferimenti Spotify ripristinati</button>
  {/if}
  {#each playlists as p (p.id)}
    <article>
      <h2>{p.name}</h2>
      <form onsubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); void run(() => repository.rename(p.id, String(data.get('name')))); }}>
        <label>Rinomina {p.name} <input name="name" value={p.name} required maxlength="100" /></label><button type="submit">Salva nome</button>
      </form>
      <div class="actions">
        {#if onplay}<button onclick={() => onplay?.(p)}>Riproduci {p.name}</button>{/if}
        {#if ondownload}<button onclick={() => ondownload?.(p)}>Scarica file locali</button><small>{p.items.filter(i => i.ref.provider === 'spotify').length} brani Spotify esclusi dal download</small>{/if}
        <button onclick={() => void run(() => repository.delete(p.id))}>Elimina {p.name}</button>
      </div>
      <ol>{#each p.items as item, i (item.itemId)}
        <li>
          <span class="badge">{item.ref.provider === 'local' ? 'File locale' : 'Spotify'}</span>
          <span>{label(item)}</span>
          {#if item.inert}<small>{item.ref.provider === 'local' ? 'File locale mancante' : 'Da riconciliare con lo stesso account Spotify'}</small>{/if}
          <div class="actions">
            <button aria-label={`Sposta su ${i + 1} di ${p.name}`} disabled={i === 0} onclick={() => void run(() => repository.move(p.id, item.itemId, i - 1))}>Su</button>
            <button aria-label={`Sposta giù ${i + 1} di ${p.name}`} disabled={i === p.items.length - 1} onclick={() => void run(() => repository.move(p.id, item.itemId, i + 1))}>Giù</button>
            <button aria-label={`Rimuovi occorrenza ${i + 1} da ${p.name}`} onclick={() => void run(() => repository.remove(p.id, item.itemId))}>Rimuovi</button>
          </div>
        </li>
      {/each}</ol>
    </article>
  {/each}
</section>
<style>
.hybrid { max-width: 64rem; margin: auto; padding: 1.5rem; }
form, li, .actions { display: flex; gap: .7rem; flex-wrap: wrap; align-items: center; margin: 1rem 0; }
label { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; }
button, input, select { min-height: 44px; }
article { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border, #444); }
small { opacity: .7; }
.badge { font-size: .8rem; padding: .2rem .5rem; border: 1px solid currentColor; border-radius: 1rem; }
</style>
