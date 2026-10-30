import { AsyncLocalStorage } from 'node:async_hooks';
import {
  SpotifyErrorCode as E,
  type SpotifyDeviceDto,
  type SpotifyEntityDto,
  type SpotifyPageDto,
  type SpotifyPlaybackDto,
  type SpotifyPlaylistItemsDto,
  type SpotifyTrackDto,
  spotifyEntityKindSchema,
  spotifyIdSchema,
  spotifyLibraryQuerySchema,
  spotifyLinkBodySchema,
  spotifyPlaybackCommandSchema,
  spotifyPlaylistBodySchema,
  spotifyPlaylistItemsBodySchema,
  spotifySavedBodySchema,
  spotifySearchQuerySchema,
} from '@spookyfy/shared';
import { z } from 'zod';
import { FakeSpotifyApi } from './fake.js';
import { SpotifyError } from './model.js';
import type { SpotifyService } from './service.js';

const entitySchema = z
  .object({
    id: spotifyIdSchema,
    name: z.string(),
    type: spotifyEntityKindSchema,
    uri: z.string(),
    artists: z.array(z.object({ name: z.string() })).optional(),
    images: z.array(z.object({ url: z.string().url() })).optional(),
    external_urls: z.object({ spotify: z.string().url() }).optional(),
    duration_ms: z.number().nonnegative().optional(),
    album: z
      .object({ name: z.string(), images: z.array(z.object({ url: z.string().url() })).optional() })
      .optional(),
    is_playable: z.boolean().optional(),
    is_local: z.boolean().optional(),
    snapshot_id: z.string().optional(),
    description: z.string().nullable().optional(),
    public: z.boolean().nullable().optional(),
    owner: z.object({ id: z.string().optional() }).passthrough().optional(),
    items: z.unknown().optional(),
    tracks: z.unknown().optional(),
    total_tracks: z.number().optional(),
  })
  .passthrough();
function contract<S extends z.ZodTypeAny>(schema: S, v: unknown): z.output<S> {
  const r = schema.safeParse(v);
  if (!r.success) throw new SpotifyError(E.ContractChanged);
  return r.data;
}
function input<S extends z.ZodTypeAny>(schema: S, v: unknown): z.output<S> {
  const r = schema.safeParse(v);
  if (!r.success) throw new SpotifyError(E.Unsupported, 400);
  return r.data;
}
interface PlaylistPermission {
  profileId?: string;
  scopes: string[];
  detail?: boolean;
}
export function entity(raw: unknown, permission?: PlaylistPermission): SpotifyEntityDto {
  const e = contract(entitySchema, raw);
  const image = e.images?.[0]?.url ?? e.album?.images?.[0]?.url ?? null;
  if (e.uri !== `spotify:${e.type}:${e.id}`) throw new SpotifyError(E.ContractChanged);
  if (e.external_urls?.spotify) {
    const u = new URL(e.external_urls.spotify);
    if (u.protocol !== 'https:' || u.hostname !== 'open.spotify.com' || u.username || u.password)
      throw new SpotifyError(E.ContractChanged);
  }
  if (image && new URL(image).protocol !== 'https:') throw new SpotifyError(E.ContractChanged);
  const dto: SpotifyEntityDto = {
    kind: e.type,
    id: e.id,
    uri: e.uri,
    name: e.name,
    artists: e.artists?.map((a) => a.name) ?? [],
    imageUrl: image,
    externalUrl: e.external_urls?.spotify ?? `https://open.spotify.com/${e.type}/${e.id}`,
  };
  if (e.type === 'track') {
    if (e.duration_ms === undefined) throw new SpotifyError(E.ContractChanged);
    Object.assign(dto, {
      durationMs: e.duration_ms,
      album: e.album?.name ?? null,
      available: e.is_playable !== false && !e.is_local,
    });
  }
  if (e.type === 'playlist') {
    dto.snapshotId = e.snapshot_id;
    dto.contentsAvailable = e.items !== undefined && e.items !== null;
    dto.description = e.description ?? '';
    if (e.public !== undefined && e.public !== null) dto.public = e.public;
    const hasScope =
      permission?.scopes.some((scope) =>
        e.public === true
          ? scope === 'playlist-modify-public'
          : e.public === false
            ? scope === 'playlist-modify-private'
            : scope === 'playlist-modify-public' || scope === 'playlist-modify-private',
      ) ?? false;
    // Only detail's documented items eligibility proves collaborator membership.
    // A simplified list's item count or collaborative flag alone cannot do so.
    dto.editable =
      hasScope &&
      (permission?.detail
        ? dto.contentsAvailable
        : !!permission?.profileId && e.owner?.id === permission.profileId);
  }
  if (e.total_tracks !== undefined) dto.trackCount = e.total_tracks;
  return dto;
}
function page(
  raw: unknown,
  offset: number,
  unwrap?: string,
  permission?: PlaylistPermission,
): SpotifyPageDto {
  const p = contract(
    z.object({
      items: z.array(z.unknown()),
      total: z.number().nonnegative(),
      next: z.string().nullable().optional(),
    }),
    raw,
  );
  // Never follow upstream-controlled next URLs: reconstruct only our validated offset.
  if (p.next) {
    let next: URL;
    try {
      next = new URL(p.next);
    } catch {
      throw new SpotifyError(E.ContractChanged);
    }
    if (next.origin !== 'https://api.spotify.com' || !next.pathname.startsWith('/v1/'))
      throw new SpotifyError(E.ContractChanged);
  }
  const items = p.items.flatMap((v) => {
    const x = unwrap && v && typeof v === 'object' ? (v as Record<string, unknown>)[unwrap] : v;
    return x ? [entity(x, permission)] : [];
  });
  return { items, total: p.total, nextOffset: p.next && p.items.length ? offset + p.items.length : null };
}
export class SpotifyApi {
  private context = new AsyncLocalStorage<{ signal: AbortSignal; session: string }>();
  private fake = new Map<string, FakeSpotifyApi>();
  private cache = new Map<string, { until: number; value: unknown }>();
  constructor(readonly service: SpotifyService) {}
  private async playlistScope(id: string, isPublic?: boolean) {
    const l = await this.service.requireScopes(id, []);
    const scopes =
      isPublic === true
        ? ['playlist-modify-public']
        : isPublic === false
          ? ['playlist-modify-private']
          : ['playlist-modify-private', 'playlist-modify-public'];
    if (!scopes.some((s) => l.scopes.includes(s))) throw new SpotifyError(E.ScopeRequired, 403);
  }
  private async playlistPermission(id: string, detail = false): Promise<PlaylistPermission> {
    const link = await this.service.requireScopes(id, []);
    const permission: PlaylistPermission = { scopes: link.scopes, detail };
    if (
      detail ||
      !link.scopes.some((scope) => scope === 'playlist-modify-public' || scope === 'playlist-modify-private')
    )
      return permission;
    try {
      const profile = contract(
        z.object({ account_id: z.string().min(1), id: z.string().min(1).optional() }),
        await this.request(id, '/me'),
      );
      if (profile.account_id !== link.accountId) {
        await this.service.markReauth(id);
        throw new SpotifyError(E.ReauthRequired, 409);
      }
      permission.profileId = profile.id;
    } catch (error) {
      if (error instanceof SpotifyError && error.code === E.ReauthRequired)
        throw error; /* Browse still works with conservative read-only permissions. */
    }
    return permission;
  }
  private async playlistItems(
    id: string,
    playlistId: string,
    offset: number,
    limit: number,
  ): Promise<SpotifyPlaylistItemsDto> {
    await this.service.requireScopes(id, ['playlist-read-private']);
    try {
      const raw = contract(
        z.object({
          items: z.array(z.object({ item: z.unknown().nullable().optional() }).passthrough()),
          total: z.number(),
          next: z.string().nullable().optional(),
        }),
        await this.request(id, `/playlists/${playlistId}/items?offset=${offset}&limit=${limit}`),
      );
      const result: SpotifyPlaylistItemsDto = {
        contentsAvailable: true,
        total: raw.total,
        nextOffset: raw.next && raw.items.length ? offset + raw.items.length : null,
        items: raw.items.map((v, i) => {
          let track: SpotifyTrackDto | null = null;
          try {
            const e = entity(v.item);
            if (e.kind === 'track') track = e as SpotifyTrackDto;
          } catch {}
          return {
            itemId: `${offset + i}`,
            position: offset + i,
            track,
            ...(!track ? { reason: 'unsupported-or-unavailable' } : {}),
          };
        }),
      };
      return result;
    } catch (e) {
      if (e instanceof SpotifyError && e.code === E.AccessRestricted)
        return { items: [], total: 0, nextOffset: null, contentsAvailable: false };
      throw e;
    }
  }
  private async request(id: string, path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const identity = await this.service.requireScopes(id, []);
    if (this.context.getStore()?.signal.aborted) throw new SpotifyError(E.Unavailable);
    if (this.service.config.mode === 'fake') {
      let fake = this.fake.get(id);
      if (!fake) {
        fake = new FakeSpotifyApi(identity.accountId);
        this.fake.set(id, fake);
      }
      return fake.request(path, method, body);
    }
    if (!/^\/[a-zA-Z0-9/?=&%_.:,*+-]+$/.test(path)) throw new SpotifyError(E.Unsupported, 400);
    const s = this.service;
    const now = s.now();
    if ((await s.store.cooldown()) > now)
      throw new SpotifyError(E.RateLimited, 429, Math.ceil(((await s.store.cooldown()) - now) / 1000));
    const start = now;
    let retried = false;
    let forceRefresh = false;
    const context = this.context.getStore();
    const signal = context?.signal;
    const cacheKey = `${id}:${identity.generation}:${identity.accountId}:${context?.session ?? ''}:${path}`;
    const cacheable = method === 'GET' && !path.startsWith('/me/player');
    const cached = this.cache.get(cacheKey);
    if (cacheable && cached && cached.until > now) return structuredClone(cached.value);
    if (!(await s.store.circuit(now))) throw new SpotifyError(E.Unavailable, 503);
    if (method !== 'GET') for (const k of this.cache.keys()) if (k.startsWith(`${id}:`)) this.cache.delete(k);
    for (;;) {
      try {
        if (signal?.aborted) throw new SpotifyError(E.Unavailable);
        const token = await s.token(id, forceRefresh, signal);
        const data = await s.raw(`https://api.spotify.com/v1${path}`, {
          method,
          signal,
          headers: {
            authorization: `Bearer ${token.accessToken}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        await s.store.circuit(s.now(), 'success');
        if (cacheable) {
          if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(cacheKey, { until: s.now() + 10000, value: structuredClone(data) });
        }
        return data;
      } catch (e) {
        if (!(e instanceof SpotifyError)) throw e;
        if (e.code === E.RateLimited) await s.store.setCooldown(s.now() + (e.retryAfter ?? 30) * 1000);
        if (e.code === E.QuotaExceeded) await s.store.setCooldown(s.now() + 30000);
        if (
          method === 'GET' &&
          !retried &&
          s.now() - start < 4000 &&
          (e.code === E.ReauthRequired || e.code === E.Unavailable)
        ) {
          retried = true;
          forceRefresh = e.code === E.ReauthRequired;
          continue;
        }
        if (e.code === E.Unavailable) {
          await s.store.circuit(s.now(), 'failure');
          if (method !== 'GET') throw new SpotifyError(E.MutationUncertain, 409);
        } else await s.store.circuit(s.now(), 'success');
        if (e.code === E.ContractChanged && method !== 'GET')
          throw new SpotifyError(E.MutationUncertain, 409);
        if (e.code === E.ReauthRequired) await s.markReauth(id);
        throw e;
      }
    }
  }
  dispatch(
    id: string,
    session: string,
    action: string,
    method: string,
    query: URLSearchParams,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<{ status: number; body?: unknown; redirect?: string }> {
    const timeout = AbortSignal.timeout(12000);
    return this.context.run({ signal: signal ? AbortSignal.any([signal, timeout]) : timeout, session }, () =>
      this.execute(id, session, action, method, query, body),
    );
  }
  private async execute(
    id: string,
    session: string,
    action: string,
    method: string,
    query: URLSearchParams,
    body: unknown,
  ): Promise<{ status: number; body?: unknown; redirect?: string }> {
    const q = Object.fromEntries(query);
    const s = this.service;
    if (action === 'status' && method === 'GET') return { status: 200, body: await s.status(id) };
    if (action === 'link' && method === 'POST')
      return {
        status: 200,
        body: await s.link(id, session, input(spotifyLinkBodySchema, body ?? {}).capability),
      };
    if (action === 'callback' && method === 'GET')
      return {
        status: 303,
        redirect: `/settings?spotify=${await s.callback(id, session, query, this.context.getStore()?.signal)}`,
      };
    if (action === 'link' && method === 'DELETE') {
      await s.unlink(id);
      this.fake.delete(id);
      for (const k of this.cache.keys()) if (k.startsWith(`${id}:`)) this.cache.delete(k);
      return { status: 204 };
    }
    if (action === 'token' && method === 'POST') {
      await s.requireScopes(id, ['streaming']);
      return { status: 200, body: await s.token(id, false, this.context.getStore()?.signal) };
    }
    if (action === 'search' && method === 'GET') {
      const p = input(spotifySearchQuerySchema, q);
      await s.requireScopes(id, []);
      const raw = contract(
        z.record(z.unknown()),
        await this.request(
          id,
          `/search?${new URLSearchParams({ q: p.q, type: p.type, limit: String(p.limit), offset: String(p.offset) })}`,
        ),
      );
      return { status: 200, body: page(raw[`${p.type}s`], p.offset) };
    }
    if (action === 'library' && method === 'GET') {
      const p = input(spotifyLibraryQuerySchema, q);
      await s.requireScopes(id, p.type === 'playlists' ? ['playlist-read-private'] : ['user-library-read']);
      return {
        status: 200,
        body: page(
          await this.request(id, `/me/${p.type}?offset=${p.offset}&limit=${p.limit}`),
          p.offset,
          p.type === 'tracks' ? 'track' : p.type === 'albums' ? 'album' : undefined,
          p.type === 'playlists' ? await this.playlistPermission(id) : undefined,
        ),
      };
    }
    if (action === 'detail' && method === 'GET') {
      const p = input(
        z.object({
          id: spotifyIdSchema,
          type: spotifyEntityKindSchema,
          offset: z.coerce.number().int().min(0).default(0),
        }),
        q,
      );
      await s.requireScopes(id, []);
      const raw = await this.request(id, `/${p.type}s/${p.id}`);
      const dto = entity(raw, p.type === 'playlist' ? await this.playlistPermission(id, true) : undefined);
      let items: unknown;
      if (p.type === 'album')
        items = page(await this.request(id, `/albums/${p.id}/tracks?limit=50&offset=${p.offset}`), p.offset);
      if (p.type === 'artist')
        items = page(await this.request(id, `/artists/${p.id}/albums?limit=50&offset=${p.offset}`), p.offset);
      if (p.type === 'playlist') {
        const playlistItems = dto.contentsAvailable
          ? await this.playlistItems(id, p.id, p.offset, 20)
          : { items: [], total: 0, nextOffset: null, contentsAvailable: false };
        items = playlistItems;
        dto.contentsAvailable = playlistItems.contentsAvailable;
        if (!playlistItems.contentsAvailable) dto.editable = false;
      }
      return { status: 200, body: { entity: dto, ...(items ? { items } : {}) } };
    }
    if (action === 'saved' && ['PUT', 'DELETE'].includes(method)) {
      const p = input(spotifySavedBodySchema, body);
      await s.requireScopes(id, ['user-library-modify']);
      for (let i = 0; i < p.uris.length; i += 40) {
        try {
          await this.request(
            id,
            `/me/library?uris=${encodeURIComponent(p.uris.slice(i, i + 40).join(','))}`,
            method,
          );
        } catch (e) {
          if (i > 0) throw new SpotifyError(E.MutationUncertain, 409);
          throw e;
        }
      }
      return { status: 204 };
    }
    if (action === 'playlist' && ['POST', 'PATCH'].includes(method)) {
      const p = input(spotifyPlaylistBodySchema, body);
      await this.playlistScope(id, p.public);
      if ((!p.name && method === 'POST') || (!p.id && method === 'PATCH'))
        throw new SpotifyError(E.Unsupported, 400);
      const { id: playlistId, ...metadata } = p;
      const raw = await this.request(
        id,
        method === 'POST' ? '/me/playlists' : `/playlists/${playlistId}`,
        method === 'POST' ? 'POST' : 'PUT',
        method === 'POST' ? { ...metadata, public: p.public ?? false } : metadata,
      );
      if (method === 'POST') {
        try {
          return { status: 201, body: entity(raw, await this.playlistPermission(id, true)) };
        } catch {
          throw new SpotifyError(E.MutationUncertain, 409);
        }
      }
      return { status: 204 };
    }
    if (action === 'playlist-items' && method === 'GET') {
      const p = input(
        z.object({
          id: spotifyIdSchema,
          offset: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        q,
      );
      return { status: 200, body: await this.playlistItems(id, p.id, p.offset, p.limit) };
    }
    if (action === 'playlist-items' && ['POST', 'PUT', 'DELETE'].includes(method)) {
      const p = input(spotifyPlaylistItemsBodySchema, body);
      await this.playlistScope(id);
      let result: unknown;
      if (method === 'PUT') {
        if (p.rangeStart === undefined || p.insertBefore === undefined)
          throw new SpotifyError(E.Unsupported, 400);
        result = await this.request(id, `/playlists/${p.id}/items`, 'PUT', {
          range_start: p.rangeStart,
          insert_before: p.insertBefore,
          range_length: p.rangeLength ?? 1,
          snapshot_id: p.snapshotId,
        });
      } else {
        if (!p.uris?.length) throw new SpotifyError(E.Unsupported, 400);
        // Current endpoint documents URI removal; never silently turn a positional
        // request into removal of every duplicate occurrence.
        if (p.positions) throw new SpotifyError(E.Unsupported, 400);
        let snapshot = p.snapshotId;
        for (let i = 0; i < p.uris.length; i += 100) {
          const uris = p.uris.slice(i, i + 100);
          try {
            result = await this.request(
              id,
              `/playlists/${p.id}/items`,
              method,
              method === 'POST' ? { uris } : { items: uris.map((uri) => ({ uri })), snapshot_id: snapshot },
            );
          } catch (e) {
            if (i > 0) throw new SpotifyError(E.MutationUncertain, 409);
            throw e;
          }
          if (result && typeof result === 'object' && 'snapshot_id' in result)
            snapshot = String(result.snapshot_id);
        }
      }
      const snapshot = z.object({ snapshot_id: z.string().min(1) }).safeParse(result);
      if (!snapshot.success) throw new SpotifyError(E.MutationUncertain, 409);
      return { status: 200, body: snapshot.data };
    }
    if (action === 'devices' && method === 'GET') {
      await s.requireScopes(id, ['user-read-playback-state']);
      const raw = contract(
        z.object({ devices: z.array(z.unknown()) }),
        await this.request(id, '/me/player/devices'),
      );
      return { status: 200, body: { devices: raw.devices.map(device) } };
    }
    if (action === 'playback' && method === 'GET') {
      await s.requireScopes(id, ['user-read-playback-state']);
      const raw = await this.request(id, '/me/player');
      if (raw === null) return { status: 200, body: null };
      const p = contract(
        z.object({
          device: z.unknown(),
          item: z.unknown().nullable(),
          is_playing: z.boolean(),
          progress_ms: z.number().nullable(),
          shuffle_state: z.boolean(),
          repeat_state: z.enum(['off', 'track', 'context']),
          // Web API returns the restriction flags directly. The SDK/older
          // fixture's nested shape is an explicit compatibility branch.
          actions: z
            .union([
              z.record(z.boolean()),
              z
                .object({ disallows: z.record(z.boolean()) })
                .strict()
                .transform((value) => value.disallows),
            ])
            .optional(),
        }),
        raw,
      );
      const state: SpotifyPlaybackDto = {
        device: device(p.device),
        track: p.item ? (entity(p.item) as SpotifyTrackDto) : null,
        playing: p.is_playing,
        positionMs: p.progress_ms ?? 0,
        shuffle: p.shuffle_state,
        repeat: p.repeat_state,
        disallows: p.actions ?? {},
      };
      return { status: 200, body: state };
    }
    if (action === 'playback' && method === 'POST') {
      const p = input(spotifyPlaybackCommandSchema, body);
      await s.requireScopes(id, ['user-modify-playback-state']);
      const suffix = p.deviceId ? `?device_id=${encodeURIComponent(p.deviceId)}` : '';
      let path = '/me/player';
      let verb = 'PUT';
      let payload: unknown;
      switch (p.action) {
        case 'play':
        case 'resume':
          path += '/play' + suffix;
          payload = p.uri
            ? { uris: [p.uri], ...(p.positionMs === undefined ? {} : { position_ms: p.positionMs }) }
            : p.contextUri
              ? {
                  context_uri: p.contextUri,
                  ...(p.offsetUri ? { offset: { uri: p.offsetUri } } : {}),
                  ...(p.positionMs === undefined ? {} : { position_ms: p.positionMs }),
                }
              : {};
          break;
        case 'pause':
          path += '/pause' + suffix;
          break;
        case 'next':
        case 'previous':
          path += `/${p.action}${suffix}`;
          verb = 'POST';
          break;
        case 'seek':
          path += `/seek?position_ms=${p.positionMs}${p.deviceId ? `&device_id=${encodeURIComponent(p.deviceId)}` : ''}`;
          break;
        case 'shuffle':
          path += `/shuffle?${new URLSearchParams({ state: String(p.state), ...(p.deviceId ? { device_id: p.deviceId } : {}) })}`;
          break;
        case 'repeat':
          path += `/repeat?${new URLSearchParams({ state: p.repeat!, ...(p.deviceId ? { device_id: p.deviceId } : {}) })}`;
          break;
        case 'volume':
          path += `/volume?${new URLSearchParams({ volume_percent: String(p.volume), ...(p.deviceId ? { device_id: p.deviceId } : {}) })}`;
          break;
        case 'transfer':
          payload = { device_ids: [p.deviceId], play: false };
          break;
      }
      await this.request(id, path, verb, payload);
      return { status: 204 };
    }
    throw new SpotifyError(E.Unsupported, 404);
  }
}
function device(raw: unknown): SpotifyDeviceDto {
  const d = contract(
    z.object({
      id: z.string().nullable(),
      name: z.string(),
      type: z.string(),
      is_active: z.boolean(),
      is_restricted: z.boolean(),
      volume_percent: z.number().nullable(),
    }),
    raw,
  );
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    isActive: d.is_active,
    isRestricted: d.is_restricted,
    volumePercent: d.volume_percent,
  };
}
