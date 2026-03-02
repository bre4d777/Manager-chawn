import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const blacklist = pgTable('blacklist', {
	id: text('id').primaryKey(),
	blacklistedBy: text('blacklisted_by').notNull().default('papa'),
	reason: text('reason').notNull().default('idl'),
	type: text('type').notNull().default('user'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
