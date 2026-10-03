ALTER TABLE `onboarding_cases` ADD `clickup_task_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `onboarding_cases_clickup_task_id_unique` ON `onboarding_cases` (`clickup_task_id`);