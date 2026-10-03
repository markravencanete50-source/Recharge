CREATE TABLE `team_coverage_areas` (
	`email` text NOT NULL,
	`region` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`email`, `region`)
);
--> statement-breakpoint
CREATE INDEX `idx_team_coverage_region` ON `team_coverage_areas` (`region`);--> statement-breakpoint
CREATE TABLE `team_role_assignments` (
	`role_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`role_id`, `email`)
);
--> statement-breakpoint
CREATE INDEX `idx_team_role_assignments_email` ON `team_role_assignments` (`email`);--> statement-breakpoint
CREATE TABLE `team_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`department` text DEFAULT 'stays' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_team_roles_name` ON `team_roles` (`name`);