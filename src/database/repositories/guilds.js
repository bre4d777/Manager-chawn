import { eq, sql } from "drizzle-orm";
import { getDatabase } from "#db/drizzle";
import { guilds } from "#dbSchema/index";
import { config } from "#config";
import { client } from "#src/bot";

/** Cache TTL for individual guild records (5 hours). */
const CACHE_TTL = 18000;
const CACHE_PREFIX = "guild:";

/**
 * Data-access layer for the `guilds` table.
 * All reads are cache-first (via the bot's {@link CacheManager}); writes invalidate
 * relevant cache keys after the database operation completes.
 */
export class GuildRepository {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * Fetches a guild by ID. Returns the cached record if available.
   * @param {string} guildId
   * @returns {Promise<Object|null>} The guild row, or `null` if not found.
   */
  async findById(guildId) {
    if (!guildId) return null;

    const cacheKey = `${CACHE_PREFIX}${guildId}`;
    const cached = await client.c.get(cacheKey);
    if (cached !== null && cached !== undefined) return cached;

    const [guild] = await this.db
      .select()
      .from(guilds)
      .where(eq(guilds.id, guildId))
      .limit(1);

    const result = guild || null;
    if (result) {
      await client.c.set(cacheKey, result, CACHE_TTL);
    }

    return result;
  }

  /**
   * Returns the guild record, inserting a default row if it doesn't exist yet.
   * The newly created record is cached and all list caches are invalidated.
   * @param {string} guildId
   * @throws {Error} If `guildId` is falsy.
   * @returns {Promise<Object>} Existing or newly created guild row.
   */
  async findOrCreate(guildId) {
    if (!guildId) {
      throw new Error("Invalid guildId");
    }

    let guild = await this.findById(guildId);

    if (!guild) {
      const now = new Date();
      const newGuild = {
        id: guildId,
        prefixes: [config.prefix],
        ignoredChannels: [],
        isCustomProfile: false,
        avatarUpdatedAt: null,
        bannerUpdatedAt: null,
        bioUpdatedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      await this.db.insert(guilds).values(newGuild);

      await Promise.all([
        client.c.set(`${CACHE_PREFIX}${guildId}`, newGuild, CACHE_TTL),
        this._invalidateListCaches(),
      ]);

      return newGuild;
    }

    return guild;
  }

  /**
   * Applies a partial update to a guild row. Automatically sets `updatedAt`.
   * Invalidates the guild's cache entry and any related list caches.
   * @param {string} guildId
   * @param {Object} data - Partial guild fields to update.
   * @returns {Promise<void>}
   */
  async update(guildId, data) {
    if (!guildId) return;

    data.updatedAt = new Date();
    await this.db.update(guilds).set(data).where(eq(guilds.id, guildId));

    await this._invalidateGuildCaches(guildId, data);
  }

  /**
   * Deletes a guild row and purges its cache entries.
   * @param {string} guildId
   * @returns {Promise<void>}
   */
  async delete(guildId) {
    if (!guildId) return;

    await this.db.delete(guilds).where(eq(guilds.id, guildId));
    await this._invalidateGuildCaches(guildId, { deleted: true });
  }

  /**
   * Returns all guild rows. Result is cached for 30 minutes.
   * @returns {Promise<Object[]>}
   */
  async findAll() {
    const cacheKey = `${CACHE_PREFIX}all`;
    const cached = await client.c.get(cacheKey);
    if (cached !== null && cached !== undefined) return cached;

    const result = await this.db.select().from(guilds);
    await client.c.set(cacheKey, result, 1800);

    return result;
  }

  /**
   * Atomically increments a numeric column on a guild row using a SQL expression.
   * Deletes the per-guild cache entry so the next read reflects the new value.
   * @param {string} guildId
   * @param {string} field - Column name to increment.
   * @param {number} [amount=1]
   * @returns {Promise<void>}
   */
  async incrementField(guildId, field, amount = 1) {
    if (!guildId || !field) return;

    await this.db
      .update(guilds)
      .set({
        [field]: sql`${guilds[field]} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(guilds.id, guildId));

    await client.c.del(`${CACHE_PREFIX}${guildId}`);
  }

  /**
   * Invalidates the per-guild cache key and the all-guilds list.
   * @param {string} guildId
   * @param {Object} [data={}] - The update payload, used to detect which extra keys need clearing.
   * @returns {Promise<void>}
   */
  async _invalidateGuildCaches(guildId, data = {}) {
    const keys = [`${CACHE_PREFIX}${guildId}`];

    keys.push(`${CACHE_PREFIX}all`);

    await client.c.mdel(keys);
  }

  /**
   * Clears the all-guilds and 24/7-enabled list caches.
   * Called after inserting a new guild.
   * @returns {Promise<void>}
   */
  async _invalidateListCaches() {
    await client.c.mdel([`${CACHE_PREFIX}all`, `${CACHE_PREFIX}247:enabled`]);
  }
}
