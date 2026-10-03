CREATE TABLE `owner_statement_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`amount_pence` integer NOT NULL,
	`created_by_email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_owner_statement_allocation_pair` ON `owner_statement_allocations` (`receipt_id`,`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_owner_statement_allocation_booking` ON `owner_statement_allocations` (`booking_id`);--> statement-breakpoint
CREATE TABLE `owner_statement_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`hostaway_reservation_id` text DEFAULT '' NOT NULL,
	`booking_reference` text DEFAULT '' NOT NULL,
	`property_id` text NOT NULL,
	`property_name` text NOT NULL,
	`owner_name` text DEFAULT '' NOT NULL,
	`owner_email` text DEFAULT '' NOT NULL,
	`channel` text NOT NULL,
	`arrival_date` text NOT NULL,
	`departure_date` text NOT NULL,
	`gross_revenue_pence` integer DEFAULT 0 NOT NULL,
	`cleaning_fee_pence` integer DEFAULT 0 NOT NULL,
	`expected_payout_pence` integer DEFAULT 0 NOT NULL,
	`actual_received_pence` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'awaiting' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_statement_bookings_source_key_unique` ON `owner_statement_bookings` (`source_key`);--> statement-breakpoint
CREATE INDEX `idx_owner_statement_booking_property_arrival` ON `owner_statement_bookings` (`property_id`,`arrival_date`);--> statement-breakpoint
CREATE INDEX `idx_owner_statement_booking_status` ON `owner_statement_bookings` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `owner_statement_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`channel` text NOT NULL,
	`payout_reference` text NOT NULL,
	`received_date` text NOT NULL,
	`amount_pence` integer NOT NULL,
	`allocated_pence` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'unmatched' NOT NULL,
	`imported_by_email` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_statement_receipts_source_key_unique` ON `owner_statement_receipts` (`source_key`);--> statement-breakpoint
CREATE INDEX `idx_owner_statement_receipt_status_date` ON `owner_statement_receipts` (`status`,`received_date`);--> statement-breakpoint
CREATE TABLE `owner_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`property_id` text NOT NULL,
	`property_name` text NOT NULL,
	`owner_name` text DEFAULT '' NOT NULL,
	`owner_email` text DEFAULT '' NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`gross_revenue_pence` integer DEFAULT 0 NOT NULL,
	`received_revenue_pence` integer DEFAULT 0 NOT NULL,
	`cleaning_cost_pence` integer DEFAULT 0 NOT NULL,
	`management_fee_pence` integer DEFAULT 0 NOT NULL,
	`owner_payout_pence` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`issued_at` integer,
	`created_by_email` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_statements_source_key_unique` ON `owner_statements` (`source_key`);--> statement-breakpoint
CREATE INDEX `idx_owner_statements_property_period` ON `owner_statements` (`property_id`,`period_start`);