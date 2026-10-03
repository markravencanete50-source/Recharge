CREATE TABLE `property_onboardings` (
	`id` text PRIMARY KEY NOT NULL,
	`property_name` text NOT NULL,
	`property_address` text DEFAULT '' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_email` text NOT NULL,
	`created_by_name` text NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_property_onboardings_status_updated` ON `property_onboardings` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `workflow_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`board` text NOT NULL,
	`lane` text DEFAULT 'new' NOT NULL,
	`source_business` text NOT NULL,
	`target_business` text NOT NULL,
	`property_name` text NOT NULL,
	`property_address` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'new' NOT NULL,
	`trigger_type` text NOT NULL,
	`source_onboarding_id` text,
	`created_by_email` text NOT NULL,
	`created_by_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workflow_tickets_board_status_created` ON `workflow_tickets` (`board`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflow_tickets_onboarding_board` ON `workflow_tickets` (`source_onboarding_id`,`board`);--> statement-breakpoint
PRAGMA optimize;
