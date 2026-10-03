CREATE TABLE `direct_booking_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`hostaway_reservation_id` text NOT NULL,
	`property_id` text DEFAULT '' NOT NULL,
	`property_name` text NOT NULL,
	`booker_name` text DEFAULT '' NOT NULL,
	`booker_email` text DEFAULT '' NOT NULL,
	`booker_phone` text DEFAULT '' NOT NULL,
	`arrival_date` text NOT NULL,
	`departure_date` text NOT NULL,
	`nights` integer NOT NULL,
	`original_gross_pence` integer DEFAULT 0 NOT NULL,
	`offered_amount_pence` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`response` text DEFAULT 'pending' NOT NULL,
	`invoice_status` text DEFAULT 'not_created' NOT NULL,
	`ota_cancelled` integer DEFAULT false NOT NULL,
	`uploaded_to_hostaway` integer DEFAULT false NOT NULL,
	`last_touch_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `direct_booking_tickets_source_key_unique` ON `direct_booking_tickets` (`source_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `direct_booking_tickets_hostaway_reservation_id_unique` ON `direct_booking_tickets` (`hostaway_reservation_id`);--> statement-breakpoint
CREATE INDEX `idx_direct_booking_status_updated` ON `direct_booking_tickets` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_direct_booking_invoice_status` ON `direct_booking_tickets` (`invoice_status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `direct_booking_touches` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`channel` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by_email` text NOT NULL,
	`created_by_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_direct_booking_touches_ticket` ON `direct_booking_touches` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `listing_health_daily_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`report_date` text NOT NULL,
	`all_visible` integer DEFAULT false NOT NULL,
	`no_negative_reviews` integer DEFAULT false NOT NULL,
	`completed_by_email` text NOT NULL,
	`completed_by_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_health_daily_reports_report_date_unique` ON `listing_health_daily_reports` (`report_date`);--> statement-breakpoint
CREATE INDEX `idx_listing_daily_report_date` ON `listing_health_daily_reports` (`report_date`);--> statement-breakpoint
CREATE TABLE `pricing_night_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`gap_ticket_id` text NOT NULL,
	`night_date` text NOT NULL,
	`current_rate_pence` integer DEFAULT 0 NOT NULL,
	`decided_rate_pence` integer DEFAULT 0 NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`pricelabs_updated` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_night_decisions_source_key_unique` ON `pricing_night_decisions` (`source_key`);--> statement-breakpoint
CREATE INDEX `idx_pricing_nights_gap_date` ON `pricing_night_decisions` (`gap_ticket_id`,`night_date`);--> statement-breakpoint
CREATE TABLE `property_weekly_pricing_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`property_id` text NOT NULL,
	`property_name` text NOT NULL,
	`week_start` text NOT NULL,
	`completed_by_email` text NOT NULL,
	`completed_by_name` text NOT NULL,
	`completed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `property_weekly_pricing_scans_source_key_unique` ON `property_weekly_pricing_scans` (`source_key`);--> statement-breakpoint
CREATE INDEX `idx_property_weekly_scan_week` ON `property_weekly_pricing_scans` (`week_start`,`property_id`);--> statement-breakpoint
ALTER TABLE `listing_health_tickets` ADD `response_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `listing_health_tickets` ADD `decision_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `pricing_opportunities` ADD `property_id` text DEFAULT '' NOT NULL;