CREATE TABLE `sessions` (
	`session_name` text PRIMARY KEY NOT NULL,
	`project_name` text NOT NULL,
	`worktree_path` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `windows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_name` text NOT NULL,
	`index` integer NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`description` text NOT NULL,
	`port` integer,
	FOREIGN KEY (`session_name`) REFERENCES `sessions`(`session_name`) ON UPDATE no action ON DELETE cascade
);