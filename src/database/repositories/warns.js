import { eq, and, desc } from "drizzle-orm";
import { getDatabase } from "#db/drizzle";
import { warns, warnConfig } from "#dbSchema/index";
import { client } from "#src/bot";

const WARN_CACHE_TTL = 300;
const CONFIG_CACHE_TTL = 3600;
const WARN_PREFIX = "warns:";
const CONFIG_PREFIX = "warnconfig:";

export class WarnRepository {
  constructor() {
    this.db = getDatabase();
  }

  async addWarn(guildId, userId, moderatorId, reason) {
    const [inserted] = await this.db
      .insert(warns)
      .values({ guildId, userId, moderatorId, reason })
      .returning();

    await client.c.del(`${WARN_PREFIX}${guildId}:${userId}`);
    return inserted;
  }

  async getWarns(guildId, userId) {
    const cacheKey = `${WARN_PREFIX}${guildId}:${userId}`;
    const cached = await client.c.get(cacheKey);
    if (cached !== null && cached !== undefined) return cached;

    const result = await this.db
      .select()
      .from(warns)
      .where(and(eq(warns.guildId, guildId), eq(warns.userId, userId)))
      .orderBy(desc(warns.createdAt));

    await client.c.set(cacheKey, result, WARN_CACHE_TTL);
    return result;
  }

  async getWarnById(id) {
    const [warn] = await this.db
      .select()
      .from(warns)
      .where(eq(warns.id, id))
      .limit(1);
    return warn || null;
  }

  async removeWarn(id, guildId, userId) {
    await this.db
      .delete(warns)
      .where(and(eq(warns.id, id), eq(warns.guildId, guildId)));
    await client.c.del(`${WARN_PREFIX}${guildId}:${userId}`);
  }

  async clearWarns(guildId, userId) {
    await this.db
      .delete(warns)
      .where(and(eq(warns.guildId, guildId), eq(warns.userId, userId)));
    await client.c.del(`${WARN_PREFIX}${guildId}:${userId}`);
  }

  async getConfig(guildId) {
    const cacheKey = `${CONFIG_PREFIX}${guildId}`;
    const cached = await client.c.get(cacheKey);
    if (cached !== null && cached !== undefined) return cached;

    const [row] = await this.db
      .select()
      .from(warnConfig)
      .where(eq(warnConfig.guildId, guildId))
      .limit(1);

    const result = row || { guildId, thresholds: [] };
    await client.c.set(cacheKey, result, CONFIG_CACHE_TTL);
    return result;
  }

  async setConfig(guildId, thresholds) {
    await this.db
      .insert(warnConfig)
      .values({ guildId, thresholds, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: warnConfig.guildId,
        set: { thresholds, updatedAt: new Date() },
      });

    await client.c.del(`${CONFIG_PREFIX}${guildId}`);
  }
}
