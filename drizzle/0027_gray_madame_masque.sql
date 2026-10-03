CREATE TABLE `routine_maintenance_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`checklist_json` text DEFAULT '{}' NOT NULL,
	`overall_condition` text NOT NULL,
	`work_completed` text DEFAULT '' NOT NULL,
	`issues_found` text DEFAULT '' NOT NULL,
	`follow_up_required` integer DEFAULT false NOT NULL,
	`follow_up_details` text DEFAULT '' NOT NULL,
	`submitted_by_email` text NOT NULL,
	`submitted_by_name` text NOT NULL,
	`submitted_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routine_maintenance_submissions_booking_id_unique` ON `routine_maintenance_submissions` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_routine_submission_condition_date` ON `routine_maintenance_submissions` (`overall_condition`,`submitted_at`);
