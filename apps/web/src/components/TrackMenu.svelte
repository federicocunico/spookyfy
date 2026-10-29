<script lang="ts">
import { pathOf } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';
import Cover from './Cover.svelte';
import Icon, { type IconName } from './Icon.svelte';
import Sheet from './Sheet.svelte';

const { ui, player, library, catalog, downloads, toasts, connection, mode, device, router } = services();
const state = $derived(ui.menu);
// "Cerca album online" solo se la ricerca è attiva.
$effect(() => {
  if (state && catalog.settings === null) void catalog.loadSettings().catch(() => {});
});

function close() {
  ui.menu = null;
}

async function run(action: () => Promise<void> | void, failure: string) {
  close();
  try {
    await action();
  } catch {
    toasts.error(failure);
  }
}

interface Action {
  id: string;
  label: string;
  icon: IconName;
  run: () => void;
  online?: boolean;
  danger?: boolean;
}

const actions = $derived.by((): Action[] => {
  const s = state;
  if (!s) return [];
  const { track, playlistId, itemId } = s;
  const status = downloads.status(track.id);
  const list: Action[] = [
    {
      id: 'favorite',
      label: track.isFavorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti',
      icon: track.isFavorite ? 'heart' : 'heart-outline',
      online: true,
      run: () => run(() => library.setFavorite(track, !track.isFavorite), 'Preferiti non aggiornati'),
    },
    {
      id: 'play-next',
      label: 'Riproduci dopo',
      icon: 'queue',
      run: () => run(() => player.playNext(track), 'Impossibile aggiungere alla coda'),
    },
    {
      id: 'add-to-playlist',
      label: 'Aggiungi a playlist',
      icon: 'plus',
      online: true,
      run: () => {
        close();
        ui.addToPlaylist = track;
      },
    },
    ...(mode === 'client'
      ? []
      : [
          {
            id: 'download',
            label: status === 'none' ? 'Scarica' : 'Rimuovi download',
            icon: status === 'none' ? 'cloud' : 'check',
            online: status === 'none',
            run: () =>
              run(
                () => (status === 'none' ? downloads.download(track) : downloads.remove(track.id)),
                'Operazione non riuscita',
              ),
          } satisfies Action,
        ]),
  ];
  // Modalità client: un brano perso dal sistema si può riscaricare (solo se viene da YouTube).
  const record = device?.library.record(track.id);
  if (device && record?.lost && record.sourceKey.startsWith('youtube:')) {
    list.unshift({
      id: 'redownload',
      label: 'Riscarica',
      icon: 'cloud',
      online: true,
      run: () =>
        run(async () => {
          await device.importer.enqueue('redownload', record.sourceKey.slice(8), {
            replaceTrackId: track.id,
          });
          toasts.show(`«${track.title}» in riscaricamento`);
        }, 'Riscaricamento non avviato'),
    });
  }
  if (playlistId && itemId) {
    list.push({
      id: 'remove-from-playlist',
      label: 'Rimuovi da questa playlist',
      icon: 'close',
      online: true,
      run: () =>
        run(() => library.removeFromPlaylist(playlistId, itemId), 'Brano non rimosso dalla playlist'),
    });
  }
  // Album e generi: categoria separata dalle playlist.
  const albumId = track.albumId;
  if (albumId) {
    list.push(
      {
        id: 'go-to-album',
        label: 'Vai all’album',
        icon: 'album',
        run: () => {
          close();
          router.navigate(pathOf.album(albumId));
        },
      },
      {
        id: 'remove-from-album',
        label: 'Togli dall’album',
        icon: 'close',
        online: true,
        run: () =>
          run(async () => void (await catalog.removeTrack(albumId, track)), 'Brano non tolto dall’album'),
      },
    );
  } else if (catalog.settings?.coverLookup !== false) {
    list.push({
      id: 'lookup',
      label: 'Cerca album online',
      icon: 'search',
      online: true,
      run: () => {
        close();
        ui.lookupTrack = track;
      },
    });
  }
  list.push(
    {
      id: 'add-to-album',
      label: albumId ? 'Sposta in un altro album…' : 'Aggiungi ad album…',
      icon: 'album',
      online: true,
      run: () => {
        close();
        ui.addToAlbum = track;
      },
    },
    {
      id: 'genres',
      label: 'Generi…',
      icon: 'music',
      online: true,
      run: () => {
        close();
        ui.editTrack = track;
      },
    },
  );
  list.push(
    {
      id: 'edit',
      label: 'Modifica informazioni',
      icon: 'edit',
      online: true,
      run: () => {
        close();
        ui.editTrack = track;
      },
    },
    {
      id: 'delete',
      label: mode === 'client' ? 'Elimina dal dispositivo' : 'Elimina dalla libreria',
      icon: 'trash',
      online: true,
      danger: true,
      run: () => {
        close();
        ui.confirm = {
          title: 'Eliminare il brano?',
          message:
            mode === 'client'
              ? `«${track.title}» verrà eliminato da questo dispositivo, insieme al file audio.`
              : `«${track.title}» verrà eliminato dalla libreria per tutti gli account, insieme al file sul server.`,
          confirmLabel: 'Elimina',
          danger: true,
          confirm: async () => {
            try {
              await library.deleteTrack(track.id);
              toasts.show('Brano eliminato');
            } catch {
              toasts.error('Il brano non è stato eliminato');
            }
          },
        };
      },
    },
  );
  return list;
});
</script>

{#if state}
  <Sheet label={`Azioni per ${state.track.title}`} onclose={close}>
    <div class="head">
      <Cover src={state.track.coverThumbUrl} color={state.track.dominantColor} size={48} />
      <div class="names">
        <strong class="ellipsis">{state.track.title}</strong>
        <span class="muted ellipsis">{state.track.artist}</span>
      </div>
    </div>
    <ul>
      {#each actions as a (a.id)}
        <li>
          <button
            class="action"
            class:danger={a.danger}
            data-action={a.id}
            disabled={a.online && connection.offline && (mode === 'onpremise' || a.id === 'redownload')}
            onclick={a.run}
          >
            <Icon name={a.icon} />
            <span>{a.label}</span>
          </button>
        </li>
      {/each}
    </ul>
  </Sheet>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border);
  }
  .names {
    min-width: 0;
    display: grid;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: var(--space-2) 0 0;
  }
  .action {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    min-height: 52px;
    text-align: left;
    color: var(--text);
  }
  .action :global(svg) {
    color: var(--text-2);
  }
  .danger,
  .danger :global(svg) {
    color: var(--danger);
  }
</style>
