ALTER TABLE `communication_threads` ADD `hostaway_listing_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `communication_threads` ADD `hostaway_reservation_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `communication_threads` ADD `opened_at` integer;