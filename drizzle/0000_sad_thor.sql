CREATE TABLE `access_users` (
	`email` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `module_permissions` (
	`email` text NOT NULL,
	`module_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`email`, `module_id`)
);
