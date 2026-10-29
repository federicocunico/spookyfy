ALTER TABLE `tracks` ADD `trim_start_ms` integer;--> statement-breakpoint
ALTER TABLE `tracks` ADD `trim_end_ms` integer;--> statement-breakpoint
ALTER TABLE `tracks` ADD `silence_checked` integer DEFAULT 0 NOT NULL;