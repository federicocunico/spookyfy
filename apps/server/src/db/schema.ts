import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  },
  (t) => [index('tracks_added_idx').on(t.addedAt)],
);

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
