import { z } from 'zod';
import type { TrackDto } from './library.js';

export const spotifyIdSchema = z.string().regex(/^[A-Za-z0-9]{22}$/);
export const spotifyTrackUriSchema = z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/);
export const spotifyUriSchema = z.string().regex(/^spotify:(track|album|artist|playlist):[A-Za-z0-9]{22}$/);
export const mediaRefSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('local'), trackId: z.string().min(1).max(64) }).strict(),
  z.object({ provider: z.literal('spotify'), uri: spotifyTrackUriSchema }).strict(),
]);
export type MediaRef = z.infer<typeof mediaRefSchema>;
export const mediaKey = (ref: MediaRef): string =>
  ref.provider === 'local' ? `local:${ref.trackId}` : ref.uri;

export const SpotifyErrorCode = {
  NotConfigured: 'SPOTIFY_NOT_CONFIGURED',
  PolicyDisabled: 'SPOTIFY_POLICY_DISABLED',
  ReauthRequired: 'SPOTIFY_REAUTH_REQUIRED',
  PremiumRequired: 'SPOTIFY_PREMIUM_REQUIRED',
  ScopeRequired: 'SPOTIFY_SCOPE_REQUIRED',
  AccessRestricted: 'SPOTIFY_ACCESS_RESTRICTED',
  RateLimited: 'SPOTIFY_RATE_LIMITED',
  QuotaExceeded: 'SPOTIFY_QUOTA_EXCEEDED',
  DeviceUnavailable: 'SPOTIFY_DEVICE_UNAVAILABLE',
  Unsupported: 'SPOTIFY_UNSUPPORTED',
  Unavailable: 'SPOTIFY_UNAVAILABLE',
  ContractChanged: 'SPOTIFY_CONTRACT_CHANGED',
  MutationUncertain: 'SPOTIFY_MUTATION_UNCERTAIN',
} as const;
export type SpotifyErrorCode = (typeof SpotifyErrorCode)[keyof typeof SpotifyErrorCode];
export type SpotifyEntitlement = 'premium' | 'non-premium' | 'unknown';
export interface ProviderCapabilities {
  canBrowse: boolean;
  canEditLibrary: boolean;
  canEditPlaylist: boolean;
  canStream: boolean;
  canDownload: boolean;
  canEditTags: boolean;
  canHybridPlayback: boolean;
}
export interface SpotifyStatusDto {
  mode: 'disabled' | 'misconfigured' | 'fake' | 'live';
  linkState: 'unlinked' | 'linked' | 'reauth-required';
  accountId: string | null;
  displayName: string | null;
  entitlement: SpotifyEntitlement;
  scopes: string[];
  generation: number;
  capabilities: ProviderCapabilities;
  reason?: SpotifyErrorCode;
  message?: string;
}
export const spotifyEntityKindSchema = z.enum(['track', 'album', 'artist', 'playlist']);
export type SpotifyEntityKind = z.infer<typeof spotifyEntityKindSchema>;
export interface SpotifyEntityDto {
  kind: SpotifyEntityKind;
  id: string;
  uri: string;
  name: string;
  artists: string[];
  imageUrl: string | null;
  externalUrl: string;
  durationMs?: number;
  album?: string | null;
  available?: boolean;
  trackCount?: number;
  snapshotId?: string;
  contentsAvailable?: boolean;
  editable?: boolean;
  description?: string;
  public?: boolean;
}
export interface SpotifyTrackDto extends SpotifyEntityDto {
  kind: 'track';
  durationMs: number;
  album: string | null;
  available: boolean;
}
export interface SpotifyPageDto<T = SpotifyEntityDto> {
  items: T[];
  nextOffset: number | null;
  total: number;
}
export interface SpotifyPlaylistItemDto {
  itemId: string;
  position: number;
  track: SpotifyTrackDto | null;
  reason?: string;
}
export interface SpotifyPlaylistItemsDto extends SpotifyPageDto<SpotifyPlaylistItemDto> {
  snapshotId?: string;
  contentsAvailable: boolean;
}
export interface SpotifyDetailDto {
  entity: SpotifyEntityDto;
  items?: SpotifyPageDto | SpotifyPlaylistItemsDto;
}
export interface SpotifyDeviceDto {
  id: string | null;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
  volumePercent: number | null;
}
export interface SpotifyPlaybackDto {
  device: SpotifyDeviceDto | null;
  track: SpotifyTrackDto | null;
  playing: boolean;
  positionMs: number;
  shuffle: boolean;
  repeat: 'off' | 'track' | 'context';
  disallows: Record<string, boolean>;
}
export interface SpotifyTokenDto {
  accessToken: string;
  expiresAt: number;
}

export const spotifyLinkBodySchema = z
  .object({
    capability: z
      .enum(['profile', 'library', 'playlist-write', 'library-write', 'playback'])
      .default('library'),
  })
  .strict();
export type SpotifyLinkBody = z.input<typeof spotifyLinkBodySchema>;
export const spotifySearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: spotifyEntityKindSchema.default('track'),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
  limit: z.coerce.number().int().min(1).max(10).default(10),
});
export const spotifyLibraryQuerySchema = z.object({
  type: z.enum(['tracks', 'albums', 'playlists']).default('playlists'),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const spotifyPlaylistBodySchema = z
  .object({
    id: spotifyIdSchema.optional(),
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(300).optional(),
    public: z.boolean().optional(),
  })
  .strict();
export const spotifyPlaylistItemsBodySchema = z
  .object({
    id: spotifyIdSchema,
    uris: z.array(spotifyTrackUriSchema).min(1).max(1000).optional(),
    snapshotId: z.string().max(256).optional(),
    positions: z.array(z.number().int().min(0)).max(1000).optional(),
    rangeStart: z.number().int().min(0).optional(),
    insertBefore: z.number().int().min(0).optional(),
    rangeLength: z.number().int().min(1).optional(),
  })
  .strict();
export const spotifySavedBodySchema = z
  .object({
    uris: z
      .array(z.string().regex(/^spotify:(track|album):[A-Za-z0-9]{22}$/))
      .min(1)
      .max(1000),
  })
  .strict();
export const spotifyPlaybackCommandSchema = z
  .object({
    action: z.enum([
      'play',
      'resume',
      'pause',
      'next',
      'previous',
      'seek',
      'shuffle',
      'repeat',
      'volume',
      'transfer',
    ]),
    deviceId: z.string().min(1).max(128).optional(),
    uri: spotifyTrackUriSchema.optional(),
    contextUri: z
      .string()
      .regex(/^spotify:(album|playlist):[A-Za-z0-9]{22}$/)
      .optional(),
    offsetUri: spotifyTrackUriSchema.optional(),
    positionMs: z.number().int().min(0).max(86400000).optional(),
    state: z.boolean().optional(),
    repeat: z.enum(['off', 'track', 'context']).optional(),
    volume: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fields: Record<string, unknown> = {
      seek: v.positionMs,
      shuffle: v.state,
      repeat: v.repeat,
      volume: v.volume,
      transfer: v.deviceId,
    };
    if (v.action in fields && fields[v.action] === undefined)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Parametro del comando mancante' });
    if (v.uri && v.contextUri)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Specificare brano oppure contesto' });
    if (v.offsetUri && !v.contextUri)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Il punto di avvio richiede un contesto' });
  });
export type SpotifyPlaybackCommand = z.infer<typeof spotifyPlaybackCommandSchema>;

export interface HybridPlaylistItemDto {
  itemId: string;
  ref: MediaRef;
  addedAt: number;
  spotifyAccountId?: string;
  inert?: boolean;
}
export interface HybridPlaylistDto {
  id: string;
  ownerId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  items: HybridPlaylistItemDto[];
}
export interface PlayableOccurrence {
  occurrenceId: string;
  ref: MediaRef;
  local?: TrackDto;
  spotify?: SpotifyTrackDto;
}
