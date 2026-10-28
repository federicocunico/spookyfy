-- Indice di ricerca full-text sui brani. Tabella FTS5 con copia propria dei testi
-- (non "external content"): i rowid di una tabella con chiave TEXT possono cambiare
-- con VACUUM, quindi la sincronizzazione avviene tramite track_id.
CREATE VIRTUAL TABLE `tracks_fts` USING fts5(
  `track_id` UNINDEXED,
  `title`,
  `artist`,
  `album`,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `tracks_fts_ai` AFTER INSERT ON `tracks` BEGIN
  INSERT INTO `tracks_fts` (`track_id`, `title`, `artist`, `album`)
  VALUES (new.`id`, new.`title`, new.`artist`, coalesce(new.`album`, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `tracks_fts_ad` AFTER DELETE ON `tracks` BEGIN
  DELETE FROM `tracks_fts` WHERE `track_id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `tracks_fts_au` AFTER UPDATE OF `title`, `artist`, `album` ON `tracks` BEGIN
  DELETE FROM `tracks_fts` WHERE `track_id` = old.`id`;
  INSERT INTO `tracks_fts` (`track_id`, `title`, `artist`, `album`)
  VALUES (new.`id`, new.`title`, new.`artist`, coalesce(new.`album`, ''));
END;
