CREATE TABLE `purchase_order_files` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by_email` text NOT NULL,
	`uploaded_by_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_order_files_object_key_unique` ON `purchase_order_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_purchase_order_files_item_kind` ON `purchase_order_files` (`item_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_purchase_order_files_order` ON `purchase_order_files` (`order_id`);--> statement-breakpoint
CREATE TABLE `purchase_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`area` text NOT NULL,
	`name` text NOT NULL,
	`required_qty` integer DEFAULT 0 NOT NULL,
	`in_property_qty` integer DEFAULT 0 NOT NULL,
	`estimate_unit_cost_pence` integer DEFAULT 0 NOT NULL,
	`actual_unit_cost_pence` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_order_items_order_position` ON `purchase_order_items` (`order_id`,`position`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`property_name` text NOT NULL,
	`client_name` text DEFAULT '' NOT NULL,
	`client_email` text DEFAULT '' NOT NULL,
	`property_type` text DEFAULT 'Flat' NOT NULL,
	`bedrooms` integer DEFAULT 0 NOT NULL,
	`beds` integer DEFAULT 0 NOT NULL,
	`sofa_beds` integer DEFAULT 0 NOT NULL,
	`bathrooms` integer DEFAULT 0 NOT NULL,
	`living_rooms` integer DEFAULT 0 NOT NULL,
	`guests` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`labour_estimate_pence` integer DEFAULT 0 NOT NULL,
	`recharge_fee_pence` integer DEFAULT 0 NOT NULL,
	`ready_invoice_pence` integer DEFAULT 0 NOT NULL,
	`management_notes` text DEFAULT '' NOT NULL,
	`client_decision_notes` text DEFAULT '' NOT NULL,
	`client_invoice_status` text DEFAULT 'not_created' NOT NULL,
	`ready_invoice_status` text DEFAULT 'not_requested' NOT NULL,
	`reconciliation_status` text DEFAULT 'not_started' NOT NULL,
	`created_by_email` text NOT NULL,
	`created_by_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_reference_unique` ON `purchase_orders` (`reference`);--> statement-breakpoint
CREATE INDEX `idx_purchase_orders_status_updated` ON `purchase_orders` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_purchase_orders_client_status` ON `purchase_orders` (`client_email`,`status`);--> statement-breakpoint
CREATE INDEX `idx_purchase_orders_accounts` ON `purchase_orders` (`client_invoice_status`,`reconciliation_status`);