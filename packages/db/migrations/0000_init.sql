CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`receives_leftover` integer DEFAULT false NOT NULL,
	`margin_cents` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`color` text NOT NULL,
	`shape` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT "accounts_margin_nonneg" CHECK("accounts"."margin_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_name_unique` ON `accounts` (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_one_leftover` ON `accounts` (`receives_leftover`) WHERE "accounts"."receives_leftover" = 1;--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`month` integer NOT NULL,
	`day` integer,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT "calendar_events_month" CHECK("calendar_events"."month" between 1 and 12),
	CONSTRAINT "calendar_events_day" CHECK("calendar_events"."day" is null or "calendar_events"."day" between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE `cycle_balances` (
	`cycle_id` text NOT NULL,
	`account_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`as_of` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY(`cycle_id`, `account_id`),
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cycle_entries` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recurring_item_id`) REFERENCES `recurring_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cycle_entries_amount" CHECK("cycle_entries"."amount_cents" is null or "cycle_entries"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX `cycle_entries_cycle` ON `cycle_entries` (`cycle_id`);--> statement-breakpoint
CREATE TABLE `cycle_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`from_account_id` text NOT NULL,
	`to_account_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`due_date` text NOT NULL,
	`done_on` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cycle_transfers_amount" CHECK("cycle_transfers"."amount_cents" > 0),
	CONSTRAINT "cycle_transfers_distinct" CHECK("cycle_transfers"."from_account_id" <> "cycle_transfers"."to_account_id")
);
--> statement-breakpoint
CREATE INDEX `cycle_transfers_cycle` ON `cycle_transfers` (`cycle_id`);--> statement-breakpoint
CREATE TABLE `cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`planned_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text,
	`imported` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT "cycles_status" CHECK("cycles"."status" in ('draft', 'confirmed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cycles_month_unique` ON `cycles` (`month`);--> statement-breakpoint
CREATE TABLE `debts` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`paid_on` text,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT "debts_amount" CHECK("debts"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `recurring_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`account_id` text NOT NULL,
	`day` integer,
	`schedule_json` text NOT NULL,
	`amount_mode` text NOT NULL,
	`amount_cents` integer,
	`note` text,
	`category` text,
	`active_from` text,
	`active_to` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurring_items_kind" CHECK("recurring_items"."kind" in ('income', 'expense')),
	CONSTRAINT "recurring_items_mode" CHECK("recurring_items"."amount_mode" in ('fixed', 'last')),
	CONSTRAINT "recurring_items_day" CHECK("recurring_items"."day" is null or "recurring_items"."day" between 1 and 31),
	CONSTRAINT "recurring_items_amount" CHECK("recurring_items"."amount_cents" is null or "recurring_items"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX `recurring_items_account` ON `recurring_items` (`account_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_by` text NOT NULL
);
