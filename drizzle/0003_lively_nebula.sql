CREATE TABLE `communication_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text NOT NULL,
	`direction` text NOT NULL,
	`phone_number` text NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`outcome` text NOT NULL,
	`answered_by_email` text,
	`answered_by_name` text,
	`started_at` integer NOT NULL,
	`answered_at` integer,
	`ended_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `communication_calls_external_id_unique` ON `communication_calls` (`external_id`);--> statement-breakpoint
CREATE INDEX `idx_communication_calls_outcome_started` ON `communication_calls` (`outcome`,`started_at`);--> statement-breakpoint
CREATE TABLE `communication_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`sent_at` integer NOT NULL,
	`responded_at` integer,
	`responded_by_email` text,
	`responded_by_name` text,
	`is_automated` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_communication_messages_thread_sent` ON `communication_messages` (`thread_id`,`sent_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_communication_messages_source_external` ON `communication_messages` (`source`,`external_id`);--> statement-breakpoint
CREATE TABLE `communication_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`property_name` text DEFAULT '' NOT NULL,
	`guest_name` text DEFAULT '' NOT NULL,
	`sender_address` text DEFAULT '' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assigned_to_email` text,
	`assigned_to_name` text,
	`last_inbound_at` integer,
	`last_outbound_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_communication_threads_source_external` ON `communication_threads` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_communication_threads_source_status_inbound` ON `communication_threads` (`source`,`status`,`last_inbound_at`);--> statement-breakpoint
CREATE TABLE `communication_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`channel` text DEFAULT 'all' NOT NULL,
	`trigger_text` text NOT NULL,
	`instructions` text NOT NULL,
	`approved_response` text DEFAULT '' NOT NULL,
	`escalation_target` text DEFAULT 'none' NOT NULL,
	`priority` text DEFAULT 'standard' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_email` text NOT NULL,
	`created_by_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_communication_workflows_status_channel_updated` ON `communication_workflows` (`status`,`channel`,`updated_at`);--> statement-breakpoint
PRAGMA optimize;
