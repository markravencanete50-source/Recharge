CREATE TABLE `routine_maintenance_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`property_name` text NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`scheduled_date` text NOT NULL,
	`start_time` text DEFAULT '' NOT NULL,
	`end_time` text DEFAULT '' NOT NULL,
	`assigned_to` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'booked' NOT NULL,
	`created_by_email` text NOT NULL,
	`created_by_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_routine_maintenance_date_status` ON `routine_maintenance_bookings` (`scheduled_date`,`status`);--> statement-breakpoint
CREATE INDEX `idx_routine_maintenance_property_date` ON `routine_maintenance_bookings` (`property_id`,`scheduled_date`);--> statement-breakpoint
CREATE INDEX `idx_routine_maintenance_region_date` ON `routine_maintenance_bookings` (`region`,`scheduled_date`);