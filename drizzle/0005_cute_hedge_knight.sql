ALTER TABLE `maintenance_tickets` ADD `hostaway_listing_id` text;--> statement-breakpoint
CREATE INDEX `idx_maintenance_tickets_hostaway_listing` ON `maintenance_tickets` (`hostaway_listing_id`);