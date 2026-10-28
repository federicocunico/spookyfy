CREATE TABLE `favorites` (
	`user_id` text NOT NULL,
	`track_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `track_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ingest_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`status` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`error` text,
	`track_id` text,
	`requested_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ingest_jobs_status_idx` ON `ingest_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `ingest_jobs_source_idx` ON `ingest_jobs` (`source_id`);--> statement-breakpoint
CREATE TABLE `playlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`playlist_id` text NOT NULL,
	`track_id` text NOT NULL,
	`position` real NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playlist_items_order_idx` ON `playlist_items` (`playlist_id`,`position`);--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playlists_owner_idx` ON `playlists` (`owner_id`);--> statement-breakpoint
CREATE TABLE `plays` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`track_id` text NOT NULL,
	`played_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plays_user_time_idx` ON `plays` (`user_id`,`played_at`);--> statement-breakpoint
CREATE INDEX `plays_user_track_idx` ON `plays` (`user_id`,`track_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`album` text,
	`duration_ms` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`dominant_color` text NOT NULL,
	`audio_path` text NOT NULL,
	`cover_path` text NOT NULL,
	`added_by` text,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_source_id_unique` ON `tracks` (`source_id`);--> statement-breakpoint
CREATE INDEX `tracks_added_idx` ON `tracks` (`added_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_normalized` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_normalized_unique` ON `users` (`username_normalized`);