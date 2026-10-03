ALTER TABLE `management_properties` ADD `merged_into_property_id` text;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `hostaway_listing_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `beds` text DEFAULT '' NOT NULL;
