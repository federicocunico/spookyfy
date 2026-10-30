import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  usernameNormalized: text('username_normalized').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const tracks = sqliteTable(
  'tracks',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    sourceId: text('source_id').notNull().unique(),
    title: text('title').notNull(),
    artist: text('artist').notNull(),
    album: text('album'),
    durationMs: integer('duration_ms').notNull(),
    /** Auto-trim: inizio e fine della riproduzione in ms (NULL = nessun silenzio da saltare). */
    trimStartMs: integer('trim_start_ms'),
    trimEndMs: integer('trim_end_ms'),
    /** 1 = silenzio ai bordi già analizzato; gli altri brani vengono analizzati in background. */
    silenceChecked: integer('silence_checked').notNull().default(0),
    sizeBytes: integer('size_bytes').notNull(),
    dominantColor: text('dominant_color').notNull(),
    /** Percorso relativo a MEDIA_DIR del file MP3. */
    audioPath: text('audio_path').notNull(),
    /** Prefisso relativo a MEDIA_DIR delle copertine: `<prefisso>-512.jpg` e `<prefisso>-128.jpg`. */
    coverPath: text('cover_path').notNull(),
    addedBy: text('added_by').references(() => users.id, { onDelete: 'set null' }),
    addedAt: integer('added_at').notNull(),
    /** Album del catalogo (il campo `album` ne è la copia del titolo, aggiornata insieme). */
    albumId: text('album_id').references((): AnySQLiteColumn => albums.id, { onDelete: 'set null' }),
    /** Posizione frazionaria nell'album, come quella degli elementi delle playlist. */
    albumPosition: real('album_position'),
  },
  (t) => [index('tracks_added_idx').on(t.addedAt), index('tracks_album_idx').on(t.albumId, t.albumPosition)],
);

export const albums = sqliteTable(
  'albums',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    artist: text('artist').notNull(),
    year: integer('year'),
    /** Forme normalizzate (albumKey) per il raggruppamento automatico. */
    titleKey: text('title_key').notNull(),
    artistKey: text('artist_key').notNull(),
    origin: text('origin', { enum: ['auto', 'manual'] }).notNull(),
    /** Prefisso della copertina assegnata (`<prefisso>-512.jpg`), NULL = quella del primo brano. */
    coverPath: text('cover_path'),
    coverColor: text('cover_color'),
    /** Cambia a ogni nuova copertina: entra negli URL per non mostrare copie vecchie dalle cache. */
    coverVersion: integer('cover_version').notNull().default(0),
    /** Ricerca automatica della copertina: da fare o già fatta (una sola volta per album). */
    lookupStatus: text('lookup_status', { enum: ['pending', 'done'] })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('albums_key_idx').on(t.titleKey, t.artistKey),
    index('albums_created_idx').on(t.createdAt),
  ],
);

export const genres = sqliteTable('genres', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  key: text('key').notNull().unique(),
});

export const trackGenres = sqliteTable(
  'track_genres',
  {
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    genreId: text('genre_id')
      .notNull()
      .references(() => genres.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.genreId] }), index('track_genres_genre_idx').on(t.genreId)],
);

/** Impostazioni del server (chiave/valore JSON) e marcatori delle migrazioni di dati. */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const ingestJobs = sqliteTable(
  'ingest_jobs',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    status: text('status', { enum: ['queued', 'running', 'completed', 'failed'] }).notNull(),
    progress: real('progress').notNull().default(0),
    error: text('error'),
    trackId: text('track_id').references(() => tracks.id, { onDelete: 'set null' }),
    requestedBy: text('requested_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('ingest_jobs_status_idx').on(t.status), index('ingest_jobs_source_idx').on(t.sourceId)],
);

export const favorites = sqliteTable(
  'favorites',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.trackId] })],
);

export const playlists = sqliteTable(
  'playlists',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('playlists_owner_idx').on(t.ownerId)],
);

export const playlistItems = sqliteTable(
  'playlist_items',
  {
    id: text('id').primaryKey(),
    playlistId: text('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    position: real('position').notNull(),
    addedAt: integer('added_at').notNull(),
  },
  (t) => [index('playlist_items_order_idx').on(t.playlistId, t.position)],
);

export const plays = sqliteTable(
  'plays',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    playedAt: integer('played_at').notNull(),
  },
  (t) => [
    index('plays_user_time_idx').on(t.userId, t.playedAt),
    index('plays_user_track_idx').on(t.userId, t.trackId),
  ],
);

export const accessTokens = sqliteTable(
  'access_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at'),
  },
  (t) => [index('access_tokens_user_idx').on(t.userId)],
);

export const hybridPlaylists = sqliteTable(
  'hybrid_playlists',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('hybrid_playlists_owner_idx').on(t.ownerId)],
);
export const hybridPlaylistItems = sqliteTable(
  'hybrid_playlist_items',
  {
    id: text('id').primaryKey(),
    playlistId: text('playlist_id')
      .notNull()
      .references(() => hybridPlaylists.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['local', 'spotify'] }).notNull(),
    trackId: text('track_id').references(() => tracks.id, { onDelete: 'cascade' }),
    uri: text('uri'),
    spotifyAccountId: text('spotify_account_id'),
    position: real('position').notNull(),
    addedAt: integer('added_at').notNull(),
  },
  (t) => [
    index('hybrid_items_order_idx').on(t.playlistId, t.position),
    check(
      'hybrid_item_reference',
      sql`(${t.provider}='local' AND ${t.trackId} IS NOT NULL AND ${t.uri} IS NULL AND ${t.spotifyAccountId} IS NULL) OR (${t.provider}='spotify' AND ${t.trackId} IS NULL AND ${t.uri} GLOB 'spotify:track:*' AND length(${t.uri})=36 AND substr(${t.uri},15) NOT GLOB '*[^A-Za-z0-9]*' AND ${t.spotifyAccountId} IS NOT NULL)`,
    ),
  ],
);
export const spotifyLinks = sqliteTable('spotify_links', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().unique(),
  envelope: text('envelope').notNull(),
  scopes: text('scopes').notNull(),
  expiresAt: integer('expires_at').notNull(),
  authorizedAt: integer('authorized_at').notNull(),
  version: integer('version').notNull().default(0),
  generation: integer('generation').notNull().default(0),
  displayName: text('display_name'),
  entitlement: text('entitlement').notNull().default('unknown'),
  reauth: integer('reauth').notNull().default(0),
});
export const spotifyOauthAttempts = sqliteTable('spotify_oauth_attempts', {
  stateHash: text('state_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionHash: text('session_hash').notNull(),
  protectedVerifier: text('protected_verifier').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  scopes: text('scopes').notNull(),
  generation: integer('generation').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const spotifyGenerations = sqliteTable('spotify_generations', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  generation: integer('generation').notNull().default(0),
});
export const spotifyLeases = sqliteTable('spotify_leases', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  owner: text('owner').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const spotifyRuntime = sqliteTable('spotify_runtime', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
});
