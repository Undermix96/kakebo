PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cycle_entries` (
	`id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`recurring_item_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer,
	`state` text NOT NULL,
	`origin` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY(`cycle_id`, `id`),
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recurring_item_id`) REFERENCES `recurring_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cycle_entries_amount" CHECK("__new_cycle_entries"."amount_cents" is null or "__new_cycle_entries"."amount_cents" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_cycle_entries`("id", "cycle_id", "recurring_item_id", "name", "kind", "account_id", "date", "amount_cents", "state", "origin", "created_at", "created_by", "updated_at", "updated_by") SELECT "id", "cycle_id", "recurring_item_id", "name", "kind", "account_id", "date", "amount_cents", "state", "origin", "created_at", "created_by", "updated_at", "updated_by" FROM `cycle_entries`;--> statement-breakpoint
DROP TABLE `cycle_entries`;--> statement-breakpoint
ALTER TABLE `__new_cycle_entries` RENAME TO `cycle_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `cycle_transfers` ADD `date` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `cycle_transfers` SET `date` = `due_date`;--> statement-breakpoint
ALTER TABLE `cycle_transfers` ADD `covers_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `cycles` ADD `confirmed_at` text;