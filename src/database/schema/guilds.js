import { pgTable, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const guilds = pgTable('guilds', {
	id: text('id').primaryKey(),
	prefixes: jsonb('prefixes').$type().notNull(),
	avatarUpdatedAt: timestamp('avatar_updated_at', { withTimezone: true }),
	bannerUpdatedAt: timestamp('banner_updated_at', { withTimezone: true }),
	bioUpdatedAt: timestamp('bio_updated_at', { withTimezone: true }),
	isCustomProfile: boolean('is_custom_profile').notNull().default(false),
	ignoredChannels: jsonb('ignored_channels').$type().notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
