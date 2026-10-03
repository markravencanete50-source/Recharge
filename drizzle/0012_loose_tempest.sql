ALTER TABLE `management_properties` ADD `clickup_task_id` text;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `clickup_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `source_status` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `source_priority` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `source_due_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `source_created_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `source_updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `property_address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `region` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `property_type` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `bedrooms` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `bathrooms` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `wc_count` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `parking` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `garden` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `owner_company` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `correspondence_address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `existing_client` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `currently_operating` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `furnishing_preference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `licensing_preference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `start_preference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `enquiry_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `additional_notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `source_description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `source_custom_fields` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `source_checklists` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `source_comments` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `source_attachments` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `source_linked_task_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `management_properties` ADD `clickup_imported_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `management_properties_clickup_task_id_unique` ON `management_properties` (`clickup_task_id`);--> statement-breakpoint
CREATE INDEX `idx_management_properties_address` ON `management_properties` (`property_address`);--> statement-breakpoint
CREATE INDEX `idx_management_properties_region_status` ON `management_properties` (`region`,`status`);