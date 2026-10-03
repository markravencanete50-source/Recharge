CREATE TABLE `team_department_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`department` text NOT NULL,
	`title` text NOT NULL,
	`schedule_date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`assigned_email` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by_email` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_team_schedule_department_date` ON `team_department_schedules` (`department`,`schedule_date`);--> statement-breakpoint
ALTER TABLE `team_roles` ADD `responsibilities` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `team_roles` ADD `regions` text DEFAULT '["General"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `team_roles` ADD `parent_role_id` text;