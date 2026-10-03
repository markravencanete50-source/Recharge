CREATE TABLE `maintenance_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`kind` text DEFAULT 'issue' NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by_email` text NOT NULL,
	`uploaded_by_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maintenance_evidence_object_key_unique` ON `maintenance_evidence` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_maintenance_evidence_ticket_created` ON `maintenance_evidence` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `maintenance_thresholds` (
	`category` text PRIMARY KEY NOT NULL,
	`management_limit_pence` integer DEFAULT 0 NOT NULL,
	`client_limit_pence` integer DEFAULT 0 NOT NULL,
	`updated_by_email` text NOT NULL,
	`updated_by_name` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_thread_id` text,
	`source_message_id` text,
	`property_name` text NOT NULL,
	`property_address` text DEFAULT '' NOT NULL,
	`client_name` text DEFAULT '' NOT NULL,
	`client_email` text DEFAULT '' NOT NULL,
	`guest_name` text DEFAULT '' NOT NULL,
	`booking_reference` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`summary` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`physical_repair` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`ready_reference` text,
	`quote_amount_pence` integer,
	`work_required` text DEFAULT '' NOT NULL,
	`proposed_repair_date` text,
	`approval_route` text DEFAULT 'unassessed' NOT NULL,
	`management_approval` text DEFAULT 'not_required' NOT NULL,
	`client_approval` text DEFAULT 'not_required' NOT NULL,
	`scheduled_date` text,
	`scheduled_start_time` text,
	`scheduled_end_time` text,
	`assigned_ready_email` text,
	`assigned_ready_name` text,
	`final_approval` text DEFAULT 'not_required' NOT NULL,
	`accounts_status` text DEFAULT 'not_created' NOT NULL,
	`invoice_reference` text DEFAULT '' NOT NULL,
	`raised_by_email` text NOT NULL,
	`raised_by_name` text NOT NULL,
	`completed_at` integer,
	`management_approved_at` integer,
	`reconciled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maintenance_tickets_reference_unique` ON `maintenance_tickets` (`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `maintenance_tickets_source_message_id_unique` ON `maintenance_tickets` (`source_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `maintenance_tickets_ready_reference_unique` ON `maintenance_tickets` (`ready_reference`);--> statement-breakpoint
CREATE INDEX `idx_maintenance_tickets_status_updated` ON `maintenance_tickets` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_maintenance_tickets_client_status` ON `maintenance_tickets` (`client_email`,`client_approval`);--> statement-breakpoint
CREATE INDEX `idx_maintenance_tickets_accounts_updated` ON `maintenance_tickets` (`accounts_status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `maintenance_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`event_type` text NOT NULL,
	`note` text NOT NULL,
	`actor_email` text NOT NULL,
	`actor_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_maintenance_updates_ticket_created` ON `maintenance_updates` (`ticket_id`,`created_at`);