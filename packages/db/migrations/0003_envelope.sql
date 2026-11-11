ALTER TABLE `cycle_entries` ADD `envelope_entry_id` text;--> statement-breakpoint
ALTER TABLE `recurring_items` ADD `is_envelope` integer DEFAULT false NOT NULL;