CREATE TABLE `clean_files` (
	`id` text PRIMARY KEY NOT NULL,
	`clean_ticket_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by_email` text NOT NULL,
	`uploaded_by_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clean_files_object_key_unique` ON `clean_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_clean_files_ticket_kind` ON `clean_files` (`clean_ticket_id`,`kind`);--> statement-breakpoint
CREATE TABLE `clean_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`hostaway_listing_id` text,
	`property_name` text NOT NULL,
	`property_address` text DEFAULT '' NOT NULL,
	`access_instructions` text DEFAULT '' NOT NULL,
	`client_name` text DEFAULT '' NOT NULL,
	`client_email` text DEFAULT '' NOT NULL,
	`cleaner_id` text,
	`clean_price_pence` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clean_properties_hostaway_listing_id_unique` ON `clean_properties` (`hostaway_listing_id`);--> statement-breakpoint
CREATE INDEX `idx_clean_properties_name` ON `clean_properties` (`property_name`);--> statement-breakpoint
CREATE INDEX `idx_clean_properties_cleaner` ON `clean_properties` (`cleaner_id`);--> statement-breakpoint
CREATE INDEX `idx_clean_properties_client` ON `clean_properties` (`client_email`);--> statement-breakpoint
CREATE TABLE `clean_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`hostaway_reservation_id` text,
	`hostaway_listing_id` text,
	`property_id` text,
	`property_name` text NOT NULL,
	`property_address` text DEFAULT '' NOT NULL,
	`guest_name` text DEFAULT '' NOT NULL,
	`booking_reference` text DEFAULT '' NOT NULL,
	`arrival_date` text,
	`clean_date` text NOT NULL,
	`channel_name` text DEFAULT '' NOT NULL,
	`assigned_cleaner_id` text,
	`assigned_cleaner_name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`broadband_working` integer,
	`heating_working` integer,
	`hot_water_working` integer,
	`maintenance_notes` text DEFAULT '' NOT NULL,
	`replenishment_notes` text DEFAULT '' NOT NULL,
	`mail_present` integer DEFAULT false NOT NULL,
	`mail_notes` text DEFAULT '' NOT NULL,
	`guest_confirmation_notes` text DEFAULT '' NOT NULL,
	`complaint_notes` text DEFAULT '' NOT NULL,
	`refund_or_cancellation` integer DEFAULT false NOT NULL,
	`invoice_week` text,
	`submitted_at` integer,
	`approved_at` integer,
	`unsuccessful_at` integer,
	`invoiced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clean_tickets_hostaway_reservation_id_unique` ON `clean_tickets` (`hostaway_reservation_id`);--> statement-breakpoint
CREATE INDEX `idx_clean_tickets_date_status` ON `clean_tickets` (`clean_date`,`status`);--> statement-breakpoint
CREATE INDEX `idx_clean_tickets_cleaner_status` ON `clean_tickets` (`assigned_cleaner_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_clean_tickets_property` ON `clean_tickets` (`property_id`);--> statement-breakpoint
CREATE TABLE `cleaner_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`cleaner_id` text NOT NULL,
	`success_rate_bps` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`closed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_cleaner_reviews_cleaner_status` ON `cleaner_reviews` (`cleaner_id`,`status`);--> statement-breakpoint
CREATE TABLE `cleaners` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cleaners_name_status` ON `cleaners` (`status`,`full_name`);--> statement-breakpoint
CREATE TABLE `client_mail_items` (
	`id` text PRIMARY KEY NOT NULL,
	`clean_ticket_id` text NOT NULL,
	`property_name` text NOT NULL,
	`property_address` text DEFAULT '' NOT NULL,
	`client_email` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`photo_file_id` text,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_mail_items_clean_ticket_id_unique` ON `client_mail_items` (`clean_ticket_id`);--> statement-breakpoint
CREATE INDEX `idx_client_mail_email_status` ON `client_mail_items` (`client_email`,`status`);--> statement-breakpoint
CREATE TABLE `replenishment_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`clean_ticket_id` text NOT NULL,
	`property_name` text NOT NULL,
	`items` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replenishment_requests_clean_ticket_id_unique` ON `replenishment_requests` (`clean_ticket_id`);--> statement-breakpoint
CREATE INDEX `idx_replenishment_status_updated` ON `replenishment_requests` (`status`,`updated_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `module_permissions` (`email`, `module_id`, `created_at`)
SELECT `email`, 'cleaner-database', unixepoch() FROM `access_users` WHERE `role` IN ('cleans', 'stays');
--> statement-breakpoint
INSERT OR IGNORE INTO `module_permissions` (`email`, `module_id`, `created_at`)
SELECT `email`, 'cleans-invoices', unixepoch() FROM `access_users` WHERE `role` IN ('cleans', 'stays');
--> statement-breakpoint
INSERT OR IGNORE INTO `module_permissions` (`email`, `module_id`, `created_at`)
SELECT `email`, 'client-mailbox', unixepoch() FROM `access_users` WHERE `role` = 'client';
