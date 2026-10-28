import type { Api } from '../api';
import type { DeviceImporter } from './importer';
import type { DeviceLibrary } from './library';
import type { BridgeClient, GatewayClient } from './remote';

export interface DeviceBackendDeps {
  library: DeviceLibrary;
  importer: DeviceImporter;
  gateway: GatewayClient;
  /** Autenticazione sul gateway: stessi endpoint dell'on-premise. */
  auth: Api['auth'];
}

/**
 * Backend della modalità client: stessa interfaccia del client HTTP on-premise,
 * ma libreria, preferiti, playlist e ascolti vivono sul dispositivo. Solo
 * autenticazione e ricerca passano dal gateway.
 */
export function createDeviceBackend(d: DeviceBackendDeps): Api {
  const { library, importer, gateway } = d;
  const markLocal = <T extends { sourceId: string }>(items: T[]) =>
    items.map((i) => {
      const t = library.bySourceKey(`youtube:${i.sourceId}`);
      return { ...i, trackId: t && !t.lost ? t.id : null };
    });
  return {
    auth: d.auth,
    tracks: {
      list: (q = {}) => library.list(q),
      get: (id) => library.get(id),
      update: (id, body) => library.updateTrack(id, body),
      delete: (id) => library.deleteTrack(id),
    },
    favorites: {
      list: async () => ({ items: await library.listFavorites() }),
      add: (id) => library.setFavorite(id, true),
      remove: (id) => library.setFavorite(id, false),
    },
    plays: {
      submit: (plays) => library.submitPlays(plays),
      recent: async (limit = 12) => ({ items: await library.recent(limit) }),
    },
    playlists: {
      list: async () => ({ items: await library.listPlaylists() }),
      get: (id) => library.getPlaylist(id),
      create: (name) => library.createPlaylist(name),
      rename: (id, name) => library.renamePlaylist(id, name),
      delete: (id) => library.deletePlaylist(id),
      addItem: (id, trackId) => library.addItem(id, trackId),
      removeItem: (id, itemId) => library.removeItem(id, itemId),
      moveItem: (id, itemId, toIndex) => library.moveItem(id, itemId, toIndex),
    },
    remote: {
      search: async (q, signal) => ({ items: markLocal((await gateway.search(q, signal)).items) }),
      ingest: async (sourceId) => {
        const existing = library.bySourceKey(`youtube:${sourceId}`);
        if (existing && !existing.lost) return { kind: 'track', track: library.toDto(existing) };
        return { kind: 'job', job: await importer.enqueue('youtube', sourceId) };
      },
      jobs: async () => ({ items: await importer.list() }),
      retry: (id) => importer.retry(id),
    },
  };
}

/** Ricerca tramite il ponte, con i brani già presenti sul dispositivo segnati. */
export async function searchViaBridge(bridge: BridgeClient, library: DeviceLibrary, q: string) {
  const { items } = await bridge.search(q);
  return items.map((i) => {
    const t = library.bySourceKey(`youtube:${i.sourceId}`);
    return { ...i, trackId: t && !t.lost ? t.id : null };
  });
}
