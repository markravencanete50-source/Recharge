CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`clock_in` integer NOT NULL,
	`clock_out` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_time_entries_email_clock_in` ON `time_entries` (`email`,`clock_in`);--> statement-breakpoint
CREATE TABLE `work_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`shift_date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`label` text DEFAULT 'Shift' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_schedules_email_date_start` ON `work_schedules` (`email`,`shift_date`,`start_time`);
--> statement-breakpoint
PRAGMA optimize;
