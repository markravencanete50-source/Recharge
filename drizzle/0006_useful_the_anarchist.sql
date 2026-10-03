ALTER TABLE `maintenance_tickets` ADD `troubleshooting_completed_items` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `troubleshooting_notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `troubleshooting_outcome` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `closed_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `closed_at` integer;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `closed_by_email` text;--> statement-breakpoint
ALTER TABLE `maintenance_tickets` ADD `closed_by_name` text;