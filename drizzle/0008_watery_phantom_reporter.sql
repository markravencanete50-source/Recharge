CREATE TABLE `onboarding_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`client_email` text NOT NULL,
	`client_name` text NOT NULL,
	`property_name` text DEFAULT '' NOT NULL,
	`property_address` text NOT NULL,
	`property_type` text NOT NULL,
	`bedrooms` integer NOT NULL,
	`bathrooms` integer NOT NULL,
	`status` text DEFAULT 'enquiry_received' NOT NULL,
	`low_nightly_rate_pence` integer,
	`medium_nightly_rate_pence` integer,
	`high_nightly_rate_pence` integer,
	`comparables` text DEFAULT '[]' NOT NULL,
	`estimate_comments` text DEFAULT '' NOT NULL,
	`estimate_published_at` integer,
	`estimate_viewed_at` integer,
	`client_decision` text DEFAULT 'pending' NOT NULL,
	`decision_feedback` text DEFAULT '' NOT NULL,
	`review_follow_up_date` text,
	`agreement_signed_at` integer,
	`agreement_signed_name` text DEFAULT '' NOT NULL,
	`business_name` text DEFAULT '' NOT NULL,
	`bank_account_name` text DEFAULT '' NOT NULL,
	`bank_account_number` text DEFAULT '' NOT NULL,
	`bank_sort_code` text DEFAULT '' NOT NULL,
	`access_date` text,
	`access_info` text DEFAULT '' NOT NULL,
	`utilities_connected` integer DEFAULT false NOT NULL,
	`utility_install_date` text,
	`prepayment_meters` integer DEFAULT false NOT NULL,
	`credit_switch_date` text,
	`broadband_connected` integer DEFAULT false NOT NULL,
	`broadband_install_date` text,
	`has_garden` integer DEFAULT false NOT NULL,
	`mail_preference` text DEFAULT '' NOT NULL,
	`warranty_details` text DEFAULT '' NOT NULL,
	`repair_permissions` text DEFAULT '{}' NOT NULL,
	`furnishing_choice` text DEFAULT 'pending' NOT NULL,
	`self_furnish_inspection_date` text,
	`form_submitted_at` integer,
	`inspection_date` text,
	`inspection_booked_at` integer,
	`health_safety_percent` integer DEFAULT 0 NOT NULL,
	`purchase_order_decision` text DEFAULT 'pending' NOT NULL,
	`purchase_order_rejection_reason` text DEFAULT '' NOT NULL,
	`reports_published_at` integer,
	`onboarding_invoice_status` text DEFAULT 'not_created' NOT NULL,
	`purchase_order_invoice_status` text DEFAULT 'not_created' NOT NULL,
	`supplier_invoice_status` text DEFAULT 'not_created' NOT NULL,
	`estimated_guest_ready_date` text,
	`listing_links` text DEFAULT '[]' NOT NULL,
	`automated_messages_ready` integer DEFAULT false NOT NULL,
	`social_post_ready` integer DEFAULT false NOT NULL,
	`guidebook_url` text DEFAULT '' NOT NULL,
	`live_at` integer,
	`created_by_email` text NOT NULL,
	`created_by_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `onboarding_cases_reference_unique` ON `onboarding_cases` (`reference`);--> statement-breakpoint
CREATE INDEX `idx_onboarding_cases_client_updated` ON `onboarding_cases` (`client_email`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_onboarding_cases_status_updated` ON `onboarding_cases` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `onboarding_files` (
	`id` text PRIMARY KEY NOT NULL,
	`onboarding_id` text NOT NULL,
	`kind` text NOT NULL,
	`room_label` text DEFAULT '' NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by_email` text NOT NULL,
	`uploaded_by_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `onboarding_files_object_key_unique` ON `onboarding_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_onboarding_files_case_kind` ON `onboarding_files` (`onboarding_id`,`kind`);--> statement-breakpoint
CREATE TABLE `onboarding_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`onboarding_id` text NOT NULL,
	`recipient_email` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`due_at` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`sent_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_onboarding_notifications_due` ON `onboarding_notifications` (`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_onboarding_notifications_case` ON `onboarding_notifications` (`onboarding_id`);--> statement-breakpoint
CREATE TABLE `onboarding_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`onboarding_id` text NOT NULL,
	`event_type` text NOT NULL,
	`note` text NOT NULL,
	`actor_email` text NOT NULL,
	`actor_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_onboarding_updates_case_created` ON `onboarding_updates` (`onboarding_id`,`created_at`);