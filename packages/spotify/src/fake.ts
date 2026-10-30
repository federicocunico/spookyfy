/** Explicit dev/test fixture. Never selected as a network-failure fallback. */
export const FAKE_TRACK_ID = '0000000000000000000001';
export const FAKE_ALBUM_ID = '0000000000000000000002';
export const FAKE_ARTIST_ID = '0000000000000000000003';
export const FAKE_PLAYLIST_ID = '0000000000000000000004';
const base = (type: string, id: string, name: string) => ({
  type,
  id,
  name,
  uri: `spotify:${type}:${id}`,
  external_urls: { spotify: `https://open.spotify.com/${type}/${id}` },
  images: [],
});
const track = {
  ...base('track', FAKE_TRACK_ID, 'Midnight demo'),
  duration_ms: 180000,
  artists: [{ name: 'Demo artist' }],
  album: { name: 'Demo album', images: [] },
  is_playable: true,
};
const album = {
  ...base('album', FAKE_ALBUM_ID, 'Demo album'),
  artists: [{ name: 'Demo artist' }],
  total_tracks: 1,
};
const artist = { ...base('artist', FAKE_ARTIST_ID, 'Demo artist') };
const playlist = {
  ...base('playlist', FAKE_PLAYLIST_ID, 'Demo playlist'),
  snapshot_id: 'fake-1',
  items: { total: 1 },
  owner: { id: 'fake-owner' },
  description: 'Demo playlist description',
  public: false,
};
export class FakeSpotifyApi {
  private playlists = new Map<string, typeof playlist>([[FAKE_PLAYLIST_ID, structuredClone(playlist)]]);
  private entries = new Map<string, unknown[]>([[FAKE_PLAYLIST_ID, [{ item: track }]]]);
  private revision = 1;
  private savedTrack = true;
  private savedAlbum = true;
  constructor(private readonly accountId: string) {
    this.playlists.get(FAKE_PLAYLIST_ID)!.owner.id = `legacy-${accountId}`;
  }
  private player: {
    device: Record<string, unknown>;
    item: typeof track;
    is_playing: boolean;
    progress_ms: number;
    shuffle_state: boolean;
    repeat_state: string;
    actions: Record<string, boolean>;
  } | null = null;
  private device = {
    id: 'fake-browser',
    name: 'Demo browser',
    type: 'Computer',
    is_active: true,
    is_restricted: false,
    volume_percent: 50,
  };
  request(path: string, method: string, body: unknown): unknown {
    const u = new URL(path, 'https://api.spotify.com');
    const offset = Number(u.searchParams.get('offset') ?? 0);
    const limit = Number(u.searchParams.get('limit') ?? 20);
    const data = body as Record<string, unknown> | undefined;
    if (u.pathname === '/me') return { account_id: this.accountId, id: `legacy-${this.accountId}` };
    const page = (items: unknown[]) => ({
      items: items.slice(offset, offset + limit),
      total: items.length,
      next: null,
    });
    if (u.pathname === '/search')
      return {
        [`${u.searchParams.get('type')}s`]: page([
          u.searchParams.get('type') === 'album'
            ? album
            : u.searchParams.get('type') === 'artist'
              ? artist
              : u.searchParams.get('type') === 'playlist'
                ? this.playlists.get(FAKE_PLAYLIST_ID)!
                : track,
        ]),
      };
    if (u.pathname === '/me/tracks') return page(this.savedTrack ? [{ track }] : []);
    if (u.pathname === '/me/albums') return page(this.savedAlbum ? [{ album }] : []);
    if (u.pathname === '/me/library') {
      for (const uri of (u.searchParams.get('uris') ?? '').split(',')) {
        if (uri.startsWith('spotify:track:')) this.savedTrack = method === 'PUT';
        if (uri.startsWith('spotify:album:')) this.savedAlbum = method === 'PUT';
      }
      return null;
    }
    if (u.pathname === '/me/playlists') {
      if (method === 'GET') return page([...this.playlists.values()]);
      const id = String(this.playlists.size + 5).padStart(22, '0');
      const p = {
        ...base('playlist', id, String(data?.name ?? 'Demo playlist')),
        snapshot_id: `fake-${++this.revision}`,
        items: { total: 0 },
        owner: { id: `legacy-${this.accountId}` },
        description: String(data?.description ?? ''),
        public: data?.public === true,
      };
      this.playlists.set(id, p);
      this.entries.set(id, []);
      return p;
    }
    const match = /^\/(tracks|albums|artists|playlists)\/([A-Za-z0-9]+)(?:\/(items|tracks|albums))?$/.exec(
      u.pathname,
    );
    if (match) {
      const [, kind, id, sub] = match;
      if (kind === 'tracks') return track;
      if (kind === 'albums') return sub ? page([track]) : album;
      if (kind === 'artists') return sub ? page([album]) : artist;
      if (kind === 'playlists' && id) {
        if (!sub) {
          if (method !== 'GET') {
            const p = this.playlists.get(id);
            if (p && data) Object.assign(p, data);
            return null;
          }
          return this.playlists.get(id) ?? playlist;
        }
        const list = this.entries.get(id) ?? [];
        if (method === 'GET') return page(list);
        if (method === 'POST')
          for (const uri of (data?.uris as string[]) ?? [])
            list.push({ item: { ...track, id: uri.split(':')[2], uri } });
        if (method === 'DELETE') {
          const remove = (data?.items as { uri: string }[]) ?? [];
          for (let i = list.length - 1; i >= 0; i--)
            if (remove.some((r) => r.uri === (list[i] as { item: { uri: string } }).item.uri))
              list.splice(i, 1);
        }
        if (
          method === 'PUT' &&
          typeof data?.range_start === 'number' &&
          typeof data.insert_before === 'number'
        ) {
          const start = data.range_start;
          const count = Number(data.range_length ?? 1);
          const before = data.insert_before;
          const moving = list.splice(start, count);
          list.splice(before > start ? before - count : before, 0, ...moving);
        }
        this.entries.set(id, list);
        const snapshot_id = `fake-${++this.revision}`;
        const metadata = this.playlists.get(id);
        if (metadata) {
          metadata.snapshot_id = snapshot_id;
          metadata.items.total = list.length;
        }
        return { snapshot_id };
      }
    }
    if (u.pathname === '/me/player/devices') return { devices: [this.device] };
    if (u.pathname === '/me/player' && method === 'GET') return this.player;
    if (u.pathname.startsWith('/me/player')) {
      if (u.pathname.endsWith('/play')) {
        const uri =
          (data?.uris as string[] | undefined)?.[0] ??
          (data?.offset as { uri?: string } | undefined)?.uri ??
          track.uri;
        this.player = {
          device: this.device,
          item: { ...track, uri, id: uri.split(':')[2]! },
          is_playing: true,
          progress_ms: Number(data?.position_ms ?? 0),
          shuffle_state: false,
          repeat_state: 'off',
          actions: {
            pausing: false,
            resuming: false,
            seeking: false,
            skipping_next: false,
            skipping_prev: false,
          },
        };
      }
      if (this.player) {
        if (u.pathname.endsWith('/pause')) this.player.is_playing = false;
        if (u.pathname.endsWith('/seek'))
          this.player.progress_ms = Number(u.searchParams.get('position_ms') ?? 0);
        if (u.pathname.endsWith('/shuffle'))
          this.player.shuffle_state = u.searchParams.get('state') === 'true';
        if (u.pathname.endsWith('/repeat')) this.player.repeat_state = u.searchParams.get('state') ?? 'off';
        if (u.pathname.endsWith('/volume'))
          this.device.volume_percent = Number(u.searchParams.get('volume_percent') ?? 50);
      }
      return null;
    }
    throw new Error('Unsupported fake Spotify endpoint');
  }
}
