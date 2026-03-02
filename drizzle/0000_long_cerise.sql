CREATE TABLE "blacklist" (
	"id" text PRIMARY KEY NOT NULL,
	"blacklisted_by" text DEFAULT 'papa' NOT NULL,
	"reason" text DEFAULT 'idl' NOT NULL,
	"type" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" text PRIMARY KEY NOT NULL,
	"prefixes" jsonb NOT NULL,
	"avatar_updated_at" timestamp with time zone,
	"banner_updated_at" timestamp with time zone,
	"bio_updated_at" timestamp with time zone,
	"is_custom_profile" boolean DEFAULT false NOT NULL,
	"ignored_channels" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
