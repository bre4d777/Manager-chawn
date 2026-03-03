import {
  pgTable,
  text,
  timestamp,
  jsonb,
  serial,
  index,
} from "drizzle-orm/pg-core";
export const warns = pgTable(
  "warns",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    moderatorId: text("moderator_id").notNull(),
    reason: text("reason").notNull().default("No reason provided"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    warnsGuildUserCreatedAtIdx: index("warns_guild_user_created_at_idx").on(
      table.guildId,
      table.userId,
      table.createdAt,
    ),
  }),
);

export const warnConfig = pgTable("warn_config", {
  guildId: text("guild_id").primaryKey(),
  thresholds: jsonb("thresholds").$type().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
