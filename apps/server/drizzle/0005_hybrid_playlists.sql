CREATE TABLE hybrid_playlists (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX hybrid_playlists_owner_idx ON hybrid_playlists(owner_id);
--> statement-breakpoint
CREATE TABLE hybrid_playlist_items (id TEXT PRIMARY KEY NOT NULL, playlist_id TEXT NOT NULL REFERENCES hybrid_playlists(id) ON DELETE CASCADE, provider TEXT NOT NULL, track_id TEXT REFERENCES tracks(id) ON DELETE CASCADE, uri TEXT, spotify_account_id TEXT, position REAL NOT NULL, added_at INTEGER NOT NULL, CONSTRAINT hybrid_item_reference CHECK ((provider='local' AND track_id IS NOT NULL AND uri IS NULL AND spotify_account_id IS NULL) OR (provider='spotify' AND track_id IS NULL AND uri GLOB 'spotify:track:*' AND length(uri)=36 AND substr(uri,15) NOT GLOB '*[^A-Za-z0-9]*' AND spotify_account_id IS NOT NULL)));
--> statement-breakpoint
CREATE INDEX hybrid_items_order_idx ON hybrid_playlist_items(playlist_id,position);
