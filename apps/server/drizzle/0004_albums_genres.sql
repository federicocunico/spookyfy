CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`year` integer,
	`title_key` text NOT NULL,
	`artist_key` text NOT NULL,
	`origin` text NOT NULL,
	`cover_path` text,
	`cover_color` text,
	`cover_version` integer DEFAULT 0 NOT NULL,
	`lookup_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `albums_key_idx` ON `albums` (`title_key`,`artist_key`);--> statement-breakpoint
CREATE INDEX `albums_created_idx` ON `albums` (`created_at`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `genres` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `genres_key_unique` ON `genres` (`key`);--> statement-breakpoint
CREATE TABLE `track_genres` (
	`track_id` text NOT NULL,
	`genre_id` text NOT NULL,
	PRIMARY KEY(`track_id`, `genre_id`),
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `track_genres_genre_idx` ON `track_genres` (`genre_id`);--> statement-breakpoint
ALTER TABLE `tracks` ADD `album_id` text REFERENCES albums(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `tracks` ADD `album_position` real;--> statement-breakpoint
CREATE INDEX `tracks_album_idx` ON `tracks` (`album_id`,`album_position`);--> statement-breakpoint
-- Indice di ricerca: si ricrea con la colonna dei generi (FTS5 non permette di aggiungerne).
DROP TRIGGER `tracks_fts_ai`;--> statement-breakpoint
DROP TRIGGER `tracks_fts_ad`;--> statement-breakpoint
DROP TRIGGER `tracks_fts_au`;--> statement-breakpoint
DROP TABLE `tracks_fts`;--> statement-breakpoint
CREATE VIRTUAL TABLE `tracks_fts` USING fts5(
  `track_id` UNINDEXED,
  `title`,
  `artist`,
  `album`,
  `genres`,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
INSERT INTO `tracks_fts` (`track_id`, `title`, `artist`, `album`, `genres`)
  SELECT `id`, `title`, `artist`, coalesce(`album`, ''), '' FROM `tracks`;
--> statement-breakpoint
CREATE TRIGGER `tracks_fts_ai` AFTER INSERT ON `tracks` BEGIN
  INSERT INTO `tracks_fts` (`track_id`, `title`, `artist`, `album`, `genres`)
  VALUES (new.`id`, new.`title`, new.`artist`, coalesce(new.`album`, ''), '');
END;
--> statement-breakpoint
CREATE TRIGGER `tracks_fts_ad` AFTER DELETE ON `tracks` BEGIN
  DELETE FROM `tracks_fts` WHERE `track_id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `tracks_fts_au` AFTER UPDATE OF `title`, `artist`, `album` ON `tracks` BEGIN
  UPDATE `tracks_fts` SET `title` = new.`title`, `artist` = new.`artist`, `album` = coalesce(new.`album`, '')
  WHERE `track_id` = old.`id`;
END;
--> statement-breakpoint
-- I generi di un brano cambiano solo tramite track_genres: si riscrive la colonna del brano.
CREATE TRIGGER `track_genres_fts_ai` AFTER INSERT ON `track_genres` BEGIN
  UPDATE `tracks_fts` SET `genres` = (
    SELECT coalesce(group_concat(g.`name`, ' '), '') FROM `track_genres` tg
    JOIN `genres` g ON g.`id` = tg.`genre_id` WHERE tg.`track_id` = new.`track_id`
  ) WHERE `track_id` = new.`track_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `track_genres_fts_ad` AFTER DELETE ON `track_genres` BEGIN
  UPDATE `tracks_fts` SET `genres` = (
    SELECT coalesce(group_concat(g.`name`, ' '), '') FROM `track_genres` tg
    JOIN `genres` g ON g.`id` = tg.`genre_id` WHERE tg.`track_id` = old.`track_id`
  ) WHERE `track_id` = old.`track_id`;
END;
