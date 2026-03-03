CREATE TABLE "warn_config" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"thresholds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warns" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"moderator_id" text NOT NULL,
	"reason" text DEFAULT 'No reason provided' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
