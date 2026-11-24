ALTER TABLE `cycle_entries` ADD `by_transfer` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `cycle_entries` ADD `paid_on` text;--> statement-breakpoint
ALTER TABLE `recurring_items` ADD `by_transfer` integer DEFAULT false NOT NULL;