CREATE TABLE `direct_booking_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`title` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `direct_booking_leads_source_key_unique` ON `direct_booking_leads` (`source_key`);--> statement-breakpoint
CREATE INDEX `idx_direct_booking_leads_status` ON `direct_booking_leads` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `listing_health_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`check_date` text NOT NULL,
	`property_id` text NOT NULL,
	`property_name` text NOT NULL,
	`airbnb_visible` integer DEFAULT false NOT NULL,
	`booking_visible` integer DEFAULT false NOT NULL,
	`comfy_visible` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_listing_check_property_date` ON `listing_health_checks` (`property_id`,`check_date`);--> statement-breakpoint
CREATE TABLE `listing_health_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`kind` text NOT NULL,
	`property_id` text DEFAULT '' NOT NULL,
	`property_name` text NOT NULL,
	`channel` text NOT NULL,
	`rating` integer,
	`review_text` text DEFAULT '' NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`responded` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_health_tickets_source_key_unique` ON `listing_health_tickets` (`source_key`);--> statement-breakpoint
CREATE INDEX `idx_listing_health_status_created` ON `listing_health_tickets` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_listing_health_property` ON `listing_health_tickets` (`property_id`,`channel`);--> statement-breakpoint
CREATE TABLE `pricing_gap_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`property_id` text NOT NULL,
	`property_name` text NOT NULL,
	`gap_start` text NOT NULL,
	`gap_end` text NOT NULL,
	`nights` integer NOT NULL,
	`current_price_pence` integer DEFAULT 0 NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`decision_reason` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_gap_tickets_source_key_unique` ON `pricing_gap_tickets` (`source_key`);--> statement-breakpoint
CREATE INDEX `idx_pricing_gap_status_start` ON `pricing_gap_tickets` (`status`,`gap_start`);--> statement-breakpoint
CREATE TABLE `pricing_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`radius_miles` integer DEFAULT 30 NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`decision_reason` text DEFAULT '' NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_opportunities_source_key_unique` ON `pricing_opportunities` (`source_key`);--> statement-breakpoint
CREATE INDEX `idx_pricing_opportunity_dates` ON `pricing_opportunities` (`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `weekly_performance_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`week_start` text NOT NULL,
	`property_id` text NOT NULL,
	`property_name` text NOT NULL,
	`client_email` text DEFAULT '' NOT NULL,
	`revenue_14d_pence` integer DEFAULT 0 NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`price_changes` text DEFAULT '[]' NOT NULL,
	`calendar_items` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_performance_reports_source_key_unique` ON `weekly_performance_reports` (`source_key`);--> statement-breakpoint
CREATE INDEX `idx_weekly_reports_client_week` ON `weekly_performance_reports` (`client_email`,`week_start`);