<script lang="ts">
import {
  ALBUM_COVER_MAX_BYTES,
  ALBUM_COVER_TYPES,
  type AlbumDto,
  type LookupCandidateDto,
  type TrackDto,
  albumKey,
  genreKey,
  updateAlbumBodySchema,
} from '@spookyfy/shared';
import { ApiError } from '../lib/api';
import { pathOf } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';
import Cover from './Cover.svelte';
import GenreInput from './GenreInput.svelte';
import Icon from './Icon.svelte';
import Sheet from './Sheet.svelte';

/** Dialoghi del catalogo: modifica album, copertina, aggiunta ad album, ricerca online di un brano. */
const { ui, catalog, api, toasts, router, mode, connection } = services();
const needsNetwork = mode === 'onpremise';

const lookupError = (err: unknown) =>
  err instanceof ApiError && err.isNetwork
    ? 'La ricerca online richiede la connessione'
    : err instanceof ApiError
      ? err.message
      : 'Ricerca non riuscita';

$effect(() => {
  if (ui.editAlbum || ui.albumCover || ui.lookupTrack) void catalog.loadSettings().catch(() => {});
  if (ui.editAlbum) void catalog.loadGenres().catch(() => {});
});

// ---------- modifica album ----------
let form = $state({ title: '', artist: '', year: '', genres: [] as string[] });
let formError = $state<string | null>(null);
let saving = $state(false);
$effect(() => {
  const a = ui.editAlbum;
  if (a) {
    form = { title: a.title, artist: a.artist, year: a.year ? String(a.year) : '', genres: [...a.genres] };
    formError = null;
  }
});

async function saveAlbum(e: SubmitEvent) {
  e.preventDefault();
  const a = ui.editAlbum;
  if (!a) return;
  const year = form.year.trim() ? Number(form.year) : null;
  const parsed = updateAlbumBodySchema.safeParse({ title: form.title, artist: form.artist, year });
  if (!parsed.success) {
    formError = parsed.error.issues[0]?.message ?? 'Valori non validi';
    return;
  }
  saving = true;
  try {
    await catalog.updateAlbum(a.id, parsed.data);
    const before = new Set(a.genres.map(genreKey));
    const after = new Set(form.genres.map(genreKey));
    const add = form.genres.filter((g) => !before.has(genreKey(g)));
    const remove = a.genres.filter((g) => !after.has(genreKey(g)));
    if (add.length || remove.length) await catalog.updateAlbumGenres(a.id, { add, remove });
    ui.editAlbum = null;
    toasts.show('Album aggiornato');
  } catch (err) {
    formError = err instanceof ApiError ? err.message : 'Salvataggio non riuscito';
  } finally {
    saving = false;
  }
}

// ---------- copertina ----------
let fileInput: HTMLInputElement | undefined = $state();
let coverError = $state<string | null>(null);
let candidates = $state<LookupCandidateDto[] | null>(null);
let searching = $state(false);
let chosen = $state<LookupCandidateDto | null>(null);
let fields = $state({ title: false, artist: false, year: false, genres: false });
$effect(() => {
  if (ui.albumCover || ui.lookupTrack) {
    coverError = null;
    candidates = null;
    chosen = null;
    fields = { title: false, artist: false, year: false, genres: false };
  }
});

async function pickFile(e: Event) {
  const a = ui.albumCover;
  const file = (e.currentTarget as HTMLInputElement).files?.[0];
  (e.currentTarget as HTMLInputElement).value = '';
  if (!a || !file) return;
  if (!(ALBUM_COVER_TYPES as readonly string[]).includes(file.type)) {
    coverError = 'Formato non supportato: scegli un’immagine JPEG, PNG o WebP';
    return;
  }
  if (file.size > ALBUM_COVER_MAX_BYTES) {
    coverError = 'L’immagine è troppo grande (massimo 10 MB)';
    return;
  }
  saving = true;
  try {
    await catalog.setCover(a.id, file);
    ui.albumCover = null;
    toasts.show('Copertina aggiornata');
  } catch (err) {
    coverError = err instanceof ApiError ? err.message : 'Copertina non salvata';
  } finally {
    saving = false;
  }
}

async function search(query: { album?: string; artist?: string; title?: string }) {
  searching = true;
  coverError = null;
  chosen = null;
  try {
    candidates = (await api.lookup.search(query)).items;
  } catch (err) {
    coverError = lookupError(err);
  } finally {
    searching = false;
  }
}

async function removeCover() {
  const a = ui.albumCover;
  if (!a) return;
  try {
    await catalog.removeCover(a.id);
    ui.albumCover = null;
    toasts.show('Copertina rimossa');
  } catch {
    coverError = 'Copertina non rimossa';
  }
}

/** Applica il candidato all'album aperto o, per un brano senza album, all'album che lo contiene. */
async function apply() {
  const c = chosen;
  if (!c) return;
  saving = true;
  coverError = null;
  try {
    let album: AlbumDto | null = ui.albumCover;
    const track = ui.lookupTrack;
    if (!album && track) {
      // Il brano entra nell'album con il titolo del candidato (creato se manca).
      const moved = await api.tracks.update(track.id, { album: c.title.slice(0, 300) });
      album = moved.albumId ? await catalog.loadAlbum(moved.albumId) : null;
    }
    if (!album) throw new Error('album');
    const a = await catalog.applyCandidate(album.id, { candidate: c, fields: { ...fields } });
    ui.albumCover = null;
    ui.lookupTrack = null;
    toasts.show(track ? `Aggiunto all’album «${a.title}»` : 'Copertina aggiornata');
    if (track) router.navigate(pathOf.album(a.id));
  } catch (err) {
    coverError = err instanceof ApiError ? err.message : 'Copertina non applicata';
  } finally {
    saving = false;
  }
}

$effect(() => {
  // Brano senza album: la ricerca parte subito con titolo e artista.
  const t = ui.lookupTrack;
  if (t) void search({ title: t.title, artist: t.artist });
});

// ---------- aggiungi ad album ----------
let filter = $state('');
$effect(() => {
  if (ui.addToAlbum) {
    filter = '';
    if (catalog.albums === null) void catalog.loadAlbums().catch(() => {});
  }
});
const filteredAlbums = $derived(
  (catalog.albums ?? []).filter((a) => {
    const q = albumKey(filter);
    return !q || albumKey(`${a.title} ${a.artist}`).includes(q);
  }),
);

async function addTo(albumId: string, title: string) {
  const track = ui.addToAlbum;
  ui.addToAlbum = null;
  if (!track) return;
  try {
    await catalog.addTracks(albumId, [track]);
    toasts.show(`Aggiunto all’album «${title}»`);
  } catch {
    toasts.error('Brano non aggiunto all’album');
  }
}

function newAlbumFor() {
  const track = ui.addToAlbum;
  ui.addToAlbum = null;
  ui.prompt = {
    title: 'Nuovo album',
    label: 'Titolo dell’album',
    value: track?.album ?? '',
    confirmLabel: 'Crea',
    submit: async (title) => {
      const a = await catalog.createAlbum({ title, artist: track?.artist });
      if (track) await catalog.addTracks(a.id, [track]);
      toasts.show(track ? `Aggiunto all’album «${a.title}»` : `Album «${a.title}» creato`);
    },
  };
}

const lookupOn = $derived(catalog.settings?.coverLookup !== false);
const sourceLabel = (c: LookupCandidateDto) => (c.source === 'musicbrainz' ? 'MusicBrainz' : 'iTunes');
const disabledOffline = $derived(needsNetwork && connection.offline);
</script>

{#if ui.editAlbum}
  <Sheet label="Modifica album" onclose={() => (ui.editAlbum = null)}>
    <form onsubmit={saveAlbum} novalidate>
      <h2 class="sheet-title">Modifica album</h2>
      <div class="field">
        <label for="album-title">Titolo</label>
        <input id="album-title" class="input" bind:value={form.title} maxlength="200" />
      </div>
      <div class="field">
        <label for="album-artist">Artista</label>
        <input id="album-artist" class="input" bind:value={form.artist} maxlength="300" />
      </div>
      <div class="field">
        <label for="album-year">Anno (facoltativo)</label>
        <input id="album-year" class="input" inputmode="numeric" bind:value={form.year} maxlength="4" />
      </div>
      <div class="field">
        <label for="album-genres">Generi di tutti i brani</label>
        <GenreInput id="album-genres" bind:value={form.genres} suggest={(p, ex) => catalog.suggestGenres(p, ex)} />
      </div>
      {#if formError}<p class="field-error" role="alert">{formError}</p>{/if}
      <div class="actions">
        <button type="button" class="btn btn-secondary" onclick={() => (ui.editAlbum = null)}>Annulla</button>
        <button type="submit" class="btn btn-primary" disabled={saving || disabledOffline}>Salva</button>
      </div>
    </form>
  </Sheet>
{/if}

{#if ui.albumCover || ui.lookupTrack}
  {@const album = ui.albumCover}
  {@const track = ui.lookupTrack}
  <Sheet
    label={album ? 'Copertina dell’album' : 'Cerca album online'}
    onclose={() => {
      ui.albumCover = null;
      ui.lookupTrack = null;
    }}
  >
    <h2 class="sheet-title">{album ? 'Copertina dell’album' : 'Cerca album online'}</h2>
    {#if track}
      <p class="muted message">Album che contengono «{track.title}» di {track.artist}.</p>
    {/if}
    {#if album}
      <div class="choices">
        <button class="row" disabled={saving || disabledOffline} onclick={() => fileInput?.click()}>
          <span class="plus"><Icon name="image" /></span> Scegli dal dispositivo
        </button>
        <input
          bind:this={fileInput}
          type="file"
          accept={ALBUM_COVER_TYPES.join(',')}
          hidden
          aria-label="Immagine della copertina"
          onchange={pickFile}
        />
        {#if lookupOn}
          <button
            class="row"
            disabled={searching || saving}
            onclick={() => search({ album: album.title, artist: album.artist })}
          >
            <span class="plus"><Icon name="search" /></span> Cerca online
          </button>
        {/if}
        {#if album.hasCustomCover}
          <button class="row" disabled={saving || disabledOffline} onclick={removeCover}>
            <span class="plus"><Icon name="trash" /></span> Rimuovi copertina
          </button>
        {/if}
      </div>
    {/if}
    {#if !lookupOn && track}
      <p class="muted message">La ricerca online è disattivata nelle Impostazioni.</p>
    {/if}
    {#if searching}
      <p class="muted message" role="status">Ricerca in corso…</p>
    {:else if candidates && candidates.length === 0}
      <p class="muted message" role="status">Nessun risultato.</p>
    {:else if candidates}
      <ul class="candidates" aria-label="Risultati della ricerca">
        {#each candidates as c (c.id)}
          <li>
            <button
              class="candidate"
              aria-pressed={chosen?.id === c.id}
              onclick={() => (chosen = c)}
              aria-label={`${c.title} di ${c.artist}${c.year ? `, ${c.year}` : ''} (${sourceLabel(c)})`}
            >
              <Cover src={api.lookup.imageUrl(c.thumbUrl)} alt="" />
              <span class="name ellipsis">{c.title}</span>
              <span class="muted sub ellipsis">{c.artist}{c.year ? ` · ${c.year}` : ''}</span>
              <span class="muted sub">{sourceLabel(c)}</span>
            </button>
          </li>
        {/each}
      </ul>
      {#if chosen}
        <fieldset class="apply">
          <legend class="muted">Applica anche</legend>
          <label><input type="checkbox" bind:checked={fields.title} /> Titolo: {chosen.title}</label>
          <label><input type="checkbox" bind:checked={fields.artist} /> Artista: {chosen.artist}</label>
          {#if chosen.year}<label><input type="checkbox" bind:checked={fields.year} /> Anno: {chosen.year}</label>{/if}
          {#if chosen.genres.length > 0}
            <label><input type="checkbox" bind:checked={fields.genres} /> Generi: {chosen.genres.join(', ')}</label>
          {/if}
        </fieldset>
      {/if}
    {/if}
    {#if coverError}<p class="field-error" role="alert">{coverError}</p>{/if}
    <div class="actions">
      <button
        class="btn btn-secondary"
        onclick={() => {
          ui.albumCover = null;
          ui.lookupTrack = null;
        }}>Chiudi</button
      >
      {#if chosen}
        <button class="btn btn-primary" disabled={saving} onclick={apply}>Applica</button>
      {/if}
    </div>
  </Sheet>
{/if}

{#if ui.addToAlbum}
  <Sheet label="Aggiungi ad album" onclose={() => (ui.addToAlbum = null)}>
    <h2 class="sheet-title">Aggiungi ad album</h2>
    <input class="input filter" type="search" placeholder="Cerca un album" aria-label="Cerca un album" bind:value={filter} />
    <button class="row new" onclick={newAlbumFor}>
      <span class="plus"><Icon name="plus" /></span> Nuovo album
    </button>
    {#each filteredAlbums as a (a.id)}
      <button class="row" onclick={() => addTo(a.id, a.title)} disabled={a.id === ui.addToAlbum.albumId}>
        <Cover src={a.coverThumbUrl} color={a.dominantColor} size={40} />
        <span class="names">
          <span class="ellipsis">{a.title}</span>
          <span class="muted sub ellipsis">{a.artist}</span>
        </span>
        <span class="muted count">{a.trackCount}</span>
      </button>
    {/each}
  </Sheet>
{/if}

<style>
  .sheet-title {
    font-size: var(--fs-l);
    font-weight: 700;
    margin-bottom: var(--space-4);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    text-align: left;
  }
  .row:disabled {
    opacity: 0.5;
  }
  .row .count {
    margin-left: auto;
    font-size: var(--fs-s);
  }
  .names {
    min-width: 0;
    display: grid;
  }
  .new {
    font-weight: 600;
  }
  .plus {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: var(--radius-s);
    background: var(--surface-hover);
  }
  .filter {
    margin-bottom: var(--space-2);
  }
  .choices {
    margin-bottom: var(--space-3);
  }
  .message {
    margin-bottom: var(--space-4);
  }
  .candidates {
    list-style: none;
    margin: 0 0 var(--space-4);
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--space-3);
  }
  .candidate {
    display: grid;
    gap: 2px;
    width: 100%;
    min-width: 0;
    padding: var(--space-2);
    border-radius: var(--radius-s);
    text-align: left;
    border: 2px solid transparent;
  }
  .candidate[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--surface-2);
  }
  .name {
    font-weight: 600;
  }
  .sub {
    font-size: var(--fs-s);
  }
  .apply {
    display: grid;
    gap: var(--space-2);
    border: 0;
    margin: 0 0 var(--space-4);
    padding: 0;
  }
  .apply label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 36px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }
</style>
