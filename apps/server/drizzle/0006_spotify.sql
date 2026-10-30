CREATE TABLE spotify_links (user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE, account_id TEXT NOT NULL, envelope TEXT NOT NULL, scopes TEXT NOT NULL, expires_at INTEGER NOT NULL, authorized_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0, display_name TEXT, entitlement TEXT NOT NULL DEFAULT 'unknown', reauth INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE spotify_oauth_attempts (state_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, session_hash TEXT NOT NULL, protected_verifier TEXT NOT NULL, redirect_uri TEXT NOT NULL, scopes TEXT NOT NULL, generation INTEGER NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE spotify_generations (user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE, generation INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE spotify_leases (user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE spotify_runtime (key TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL);

--> statement-breakpoint
CREATE UNIQUE INDEX spotify_links_account_id_unique ON spotify_links(account_id);
