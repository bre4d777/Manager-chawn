import { eq, and, desc } from "drizzle-orm";
import { getDatabase } from "#db/drizzle";
import { warns, warnConfig } from "#dbSchema/index";
import { client } from "#src/bot";

/** Cache TTL for warning records (5 minutes). */
const WARN_CACHE_TTL = 300;
/** Cache TTL for guild warning configurations (1 hour). */
const CONFIG_CACHE_TTL = 3600;

const WARN_PREFIX = "warns:";
const CONFIG_PREFIX = "warnconfig:";

/**
 * Data-access layer for user warnings and guild punishment configurations.
 * Implements a cache-aside strategy using the bot's central cache.
 */
export class WarnRepository {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * Records a new warning in the database and invalidates the user's warning cache.
   * @param {string} guildId - Discord Guild ID.
   * @param {string} userId - ID of the warned user.
   * @param {string} moderatorId - ID of the issuing moderator.
   * @param {string} reason - The reason for the warning.
   * @returns {Promise<Object>} The newly created warning record.
   */
  async addWarn(guildId, userId, moderatorId, reason) {
    const [inserted] = await this.db
      .insert(warns)
      .values({ guildId, userId, moderatorId, reason })
      .returning();

    await client.c.del(`${WARN_PREFIX}${guildId}:${userId}`);
    return inserted;
  }

  /**
   * Retrieves all warnings for a specific user, ordered by newest first.
   * Results are cached for 5 minutes.
   * @param {string} guildId
   * @param {string} userId
   * @returns {Promise<Object[]>}
   */
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

  /**
   * Fetches a single warning by its internal ID.
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async getWarnById(id) {
    const [warn] = await this.db
      .select()
      .from(warns)
      .where(eq(warns.id, id))
      .limit(1);
    return warn || null;
  }

  /**
   * Removes a specific warning and clears relevant cache.
   * @param {number|string} id
   * @param {string} guildId
   * @param {string} userId
   */
  async removeWarn(id, guildId, userId) {
    await this.db
      .delete(warns)
      .where(
        and(
          eq(warns.id, id),
          eq(warns.guildId, guildId),
          eq(warns.userId, userId),
        ),
      );
    await client.c.del(`${WARN_PREFIX}${guildId}:${userId}`);
  }

  /**
   * Clears all warnings for a user within a specific guild.
   * @param {string} guildId
   * @param {string} userId
   */
  async clearWarns(guildId, userId) {
    await this.db
      .delete(warns)
      .where(and(eq(warns.guildId, guildId), eq(warns.userId, userId)));
    await client.c.del(`${WARN_PREFIX}${guildId}:${userId}`);
  }

  /**
   * Retrieves the punishment thresholds for a guild.
   * Returns a default empty threshold list if no config exists.
   * @param {string} guildId
   * @returns {Promise<Object>}
   */
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

  /**
   * Updates or creates the warning configuration for a guild.
   * Invalidates the guild's config cache.
   * @param {string} guildId
   * @param {Array<Object>} thresholds - Array of threshold settings.
   */
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
