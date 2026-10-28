import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import DeviceNotices from '../components/DeviceNotices.svelte';
import DeviceSettings from '../components/DeviceSettings.svelte';
import Dialogs from '../components/Dialogs.svelte';
import TokensSection from '../components/TokensSection.svelte';
import TrackMenu from '../components/TrackMenu.svelte';
import { DEVICE_AUDIO_CACHE, localAudioUrl } from '../lib/device/library';
import { patchSettings } from '../lib/device/settings';
import { reconcileDevice } from '../lib/services.svelte';
import type { TokensApi } from '../lib/tokens-api';
import { setupClientServices } from '../test/client-fixtures';
import { flush, setupServices } from '../test/fixtures';
import LibraryView from './LibraryView.svelte';
import SearchView from './SearchView.svelte';

afterEach(() => vi.unstubAllGlobals());

async function importOne(s: Awaited<ReturnType<typeof setupClientServices>>, id = 'abcdefghijk') {
  await s.api.remote.ingest(id);
  await s.device!.importer.idle();
  return (await s.api.tracks.list({})).items.find((t) => t.sourceId === id)!;
}

describe('interfaccia per modalità', () => {
  test('Libreria in modalità client: importa da file, niente filtro "Scaricati"', async () => {
    const s = await setupClientServices();
    render(LibraryView);
    expect(await screen.findByRole('button', { name: 'Importa da file' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Scaricati/ })).toBeNull();
    s.device!.importer.stop();
  });

  test('Libreria in modalità on-premise: invariata (filtro Scaricati, nessun import da file)', async () => {
    await setupServices();
    render(LibraryView);
    expect(await screen.findByRole('link', { name: /Scaricati/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Importa da file' })).toBeNull();
  });

  test('menu del brano in modalità client: niente download, eliminazione dal dispositivo anche offline', async () => {
    const s = await setupClientServices();
    const track = await importOne(s);
    s.connection.set({ online: false });
    render(TrackMenu);
    render(Dialogs);
    s.ui.menu = { track };
    await flush();
    expect(document.querySelector('[data-action="download"]')).toBeNull();
    const del = document.querySelector<HTMLButtonElement>('[data-action="delete"]')!;
    expect(del).toHaveTextContent('Elimina dal dispositivo');
    expect(del).toBeEnabled();
    expect(document.querySelector<HTMLButtonElement>('[data-action="favorite"]')).toBeEnabled();
    await userEvent.click(del);
    expect(screen.getByText(/verrà eliminato da questo dispositivo/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    await vi.waitFor(async () => expect((await s.api.tracks.list({})).items).toEqual([]));
    s.device!.importer.stop();
  });
});

describe('spazio e perdita dei dati', () => {
  test('spazio occupato, disponibile e numero di brani', async () => {
    const s = await setupClientServices({
      audioSize: 3000,
      storageEstimate: { usage: 1024 ** 2, quota: 5 * 1024 ** 3 },
    });
    await importOne(s);
    render(DeviceSettings);
    expect(await screen.findByTestId('device-count')).toHaveTextContent('1');
    expect(screen.getByTestId('device-usage')).toHaveTextContent('1 MB');
    await vi.waitFor(() => expect(screen.getByTestId('device-free')).toHaveTextContent('5,0 GB'));
    s.device!.importer.stop();
  });

  test('storage non persistente: avviso specifico della modalità client', async () => {
    const s = await setupClientServices();
    s.storage.persisted = false;
    s.storage.refresh = async () => {};
    render(DeviceSettings);
    expect(await screen.findByTestId('client-storage-warning')).toHaveTextContent(/potrebbe cancellarla/);
    s.device!.importer.stop();
  });

  test('cache eliminata dal sistema: avviso con i brani persi e "Riscarica" nel menu', async () => {
    const s = await setupClientServices();
    const track = await importOne(s);
    await (await caches.open(DEVICE_AUDIO_CACHE)).delete(
      new URL(localAudioUrl(track.id), location.href).href,
    );
    expect(await reconcileDevice(s)).toEqual([track.id]);
    render(DeviceNotices);
    expect(await screen.findByTestId('lost-banner')).toHaveTextContent('Un brano è stato eliminato');
    render(TrackMenu);
    s.ui.menu = { track };
    await flush();
    await userEvent.click(document.querySelector<HTMLButtonElement>('[data-action="redownload"]')!);
    await s.device!.importer.idle();
    expect(s.isLocal(track.id)).toBe(true);
    s.device!.importer.stop();
  });

  test('promemoria di backup dopo 20 brani aggiunti', async () => {
    const s = await setupClientServices();
    await importOne(s);
    await patchSettings(await s.db(), { addedSinceBackup: 25 });
    render(DeviceNotices);
    expect(await screen.findByTestId('backup-reminder')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Più tardi' }));
    expect(screen.queryByTestId('backup-reminder')).toBeNull();
    s.device!.importer.stop();
  });
});

describe('blocco di YouTube', () => {
  test('ricerca bloccata: alternative con importazione da file e ricerca tramite il server di casa', async () => {
    const s = await setupClientServices({ searchBlocked: true });
    await patchSettings(await s.db(), { bridge: { url: 'https://casa.example', token: 'spk_x' } });
    render(SearchView);
    await userEvent.type(screen.getByRole('searchbox'), 'nirvana{Enter}');
    expect(await screen.findByText(/YouTube ha bloccato/)).toBeInTheDocument();
    const alt = await screen.findByTestId('search-alternatives');
    expect(alt).toHaveTextContent('Importa da file');
    expect(
      await screen.findByRole('button', { name: 'Cerca tramite il server di casa' }),
    ).toBeInTheDocument();
    s.device!.importer.stop();
  });

  test('importazione bloccata: messaggio e alternative sul risultato, "Riprova"', async () => {
    const s = await setupClientServices();
    // La ricerca funziona ma il video è bloccato all'importazione.
    s.api.remote.search = async () => ({
      items: [
        {
          sourceId: 'blocked0000',
          title: 'Bloccato',
          artist: 'X',
          durationMs: 1000,
          thumbnailUrl: '',
          trackId: null,
        },
      ],
    });
    render(SearchView);
    await userEvent.type(screen.getByRole('searchbox'), 'x{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /Aggiungi Bloccato/ }));
    await s.device!.importer.idle();
    expect(await screen.findByTestId('blocked-alternatives')).toHaveTextContent('Importa da file');
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
    s.device!.importer.stop();
  });
});

describe('token di accesso (on-premise)', () => {
  test('creazione con token mostrato una sola volta, elenco e revoca', async () => {
    await setupServices();
    const items: { id: string; name: string; createdAt: number; lastUsedAt: number | null }[] = [];
    const client: TokensApi = {
      list: vi.fn(async () => ({ items: [...items] })),
      create: vi.fn(async (name: string) => {
        const t = { id: `t${items.length}`, name, createdAt: 1, lastUsedAt: null };
        items.push(t);
        return { ...t, token: 'spk_segreto' };
      }),
      revoke: vi.fn(async (id: string) => {
        items.splice(
          items.findIndex((t) => t.id === id),
          1,
        );
      }),
    };
    render(TokensSection, { client });
    render(Dialogs);
    await userEvent.type(screen.getByLabelText('Nome del token'), 'iPhone client');
    await userEvent.click(screen.getByRole('button', { name: 'Crea' }));
    expect(await screen.findByTestId('new-token')).toHaveTextContent('spk_segreto');
    expect(await screen.findByText('iPhone client')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fatto' }));
    expect(screen.queryByTestId('new-token')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Revoca iPhone client' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Revoca' }));
    await vi.waitFor(() => expect(client.revoke).toHaveBeenCalledWith('t0'));
    await vi.waitFor(() => expect(screen.getByText('Nessun token.')).toBeInTheDocument());
  });
});
