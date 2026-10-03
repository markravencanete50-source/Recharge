CREATE TABLE `management_property_sources` (
	`clickup_task_id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`clickup_url` text NOT NULL,
	`source_status` text DEFAULT '' NOT NULL,
	`source_property_name` text DEFAULT '' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`imported_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_management_property_sources_property` ON `management_property_sources` (`property_id`);--> statement-breakpoint
CREATE INDEX `idx_management_property_sources_status` ON `management_property_sources` (`source_status`);