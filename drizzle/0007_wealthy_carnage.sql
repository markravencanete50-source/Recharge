CREATE TABLE `management_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`hostaway_listing_id` text,
	`property_name` text NOT NULL,
	`owner_name` text DEFAULT '' NOT NULL,
	`owner_email` text DEFAULT '' NOT NULL,
	`owner_phone` text DEFAULT '' NOT NULL,
	`access_code` text DEFAULT '' NOT NULL,
	`access_info` text DEFAULT '' NOT NULL,
	`guidebook_url` text DEFAULT '' NOT NULL,
	`listing_links` text DEFAULT '[]' NOT NULL,
	`payout_schedule` text DEFAULT '' NOT NULL,
	`management_fee_bps` integer DEFAULT 0 NOT NULL,
	`payout_notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_synced_at` integer,
	`updated_by_email` text NOT NULL,
	`updated_by_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `management_properties_hostaway_listing_id_unique` ON `management_properties` (`hostaway_listing_id`);--> statement-breakpoint
CREATE INDEX `idx_management_properties_name` ON `management_properties` (`property_name`);--> statement-breakpoint
CREATE INDEX `idx_management_properties_owner` ON `management_properties` (`owner_email`,`owner_name`);--> statement-breakpoint
CREATE INDEX `idx_management_properties_status` ON `management_properties` (`status`);--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `hostaway_reservation_id` text;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `reservation_arrival_date` text;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `reservation_departure_date` text;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `reservation_channel` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `payment_reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `paid_at` integer;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `paid_by_email` text;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `paid_by_name` text;