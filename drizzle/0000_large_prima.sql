CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`ats_type` text,
	`ats_url` text,
	`is_monitored` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_name_unique` ON `companies` (`name`);--> statement-breakpoint
CREATE TABLE `job_matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`score` integer NOT NULL,
	`why_matched` text,
	`missing_skills` text,
	`resume_gaps` text,
	`interview_probability` text,
	`apply_recommendation` text,
	`priority_score` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_matches_job_id_unique` ON `job_matches` (`job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`location` text,
	`salary` text,
	`posted_at` text DEFAULT CURRENT_TIMESTAMP,
	`hash` text NOT NULL,
	`raw_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_url_unique` ON `jobs` (`url`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_hash_unique` ON `jobs` (`hash`);--> statement-breakpoint
CREATE TABLE `recruiters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer,
	`name` text NOT NULL,
	`title` text,
	`linkedin_url` text,
	`email` text,
	`outreach_status` text DEFAULT 'none' NOT NULL,
	`personalized_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `resume_profile` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parsed_json` text NOT NULL,
	`raw_text` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
