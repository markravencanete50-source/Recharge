CREATE TABLE `team_directory_people` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`department` text DEFAULT 'stays' NOT NULL,
	`responsibilities` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`role_ids` text DEFAULT '[]' NOT NULL,
	`regions` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_team_directory_department_status` ON `team_directory_people` (`department`,`status`);