import { WarnRepository } from "#dbRepo/warns";

const VALID_ACTIONS = ["timeout", "kick", "ban"];
const DURATION_UNITS = { s: 1, m: 60, h: 3_600, d: 86_400, w: 604_800 };
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1_000;
const MAX_AUDIT_REASON_LENGTH = 512

/**
 * Business-logic layer for the warning system.
 * Handles duration parsing, threshold management, and punishment execution.
 */
export class WarnService {
  constructor() {
    this.repo = new WarnRepository();
  }

  /**
   * Parses a string duration (e.g., "1h", "2d") into milliseconds.
   * Caps the result at 28 days.
   * @param {string} raw
   * @returns {number|null} Duration in ms, or null if invalid.
   */
  parseDuration(raw) {
    const match = String(raw).match(/^(\d+)(s|m|h|d|w)$/i);
    if (!match) return null;
    const ms =
      parseInt(match[1], 10) *
      (DURATION_UNITS[match[2].toLowerCase()] ?? 0) *
      1_000;
    return ms > 0 && ms <= MAX_TIMEOUT_MS ? ms : null;
  }

  /**
   * Converts milliseconds into a human-readable string (e.g., "1d 2h").
   * @param {number} ms
   * @returns {string}
   */
  formatDuration(ms) {
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);
    return [d && `${d}d`, h && `${h}h`, m && `${m}m`, s && `${s}s`]
      .filter(Boolean)
      .join(" ");
  }

  /**
   * Issues a new warning.
   * @returns {Promise<Object>}
   */
  async addWarn(guildId, userId, moderatorId, reason) {
    return await this.repo.addWarn(guildId, userId, moderatorId, reason);
  }

  /**
   * Fetches warning history for a user.
   * @returns {Promise<Object[]>}
   */
  async getWarns(guildId, userId) {
    return await this.repo.getWarns(guildId, userId);
  }

  /**
   * Returns the total number of warnings a user has in a guild.
   * @returns {Promise<number>}
   */
  async getWarnCount(guildId, userId) {
    const warns = await this.repo.getWarns(guildId, userId);
    return warns.length;
  }

  /**
   * Validates and removes a warning. Returns false if the ID is invalid for the guild.
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async removeWarn(id, guildId, userId) {
    const warn = await this.repo.getWarnById(id);
    if (!warn || warn.guildId !== guildId || warn.userId !== userId)
      return false;
    await this.repo.removeWarn(id, guildId, userId);
    return true;
  }

  /**
   * Resets all warnings for a user.
   */
  async clearWarns(guildId, userId) {
    await this.repo.clearWarns(guildId, userId);
  }

  /**
   * Retrieves guild configuration including thresholds.
   */
  async getConfig(guildId) {
    return await this.repo.getConfig(guildId);
  }

  /**
   * Sets and sorts punishment thresholds.
   * @param {string} guildId
   * @param {Array<Object>} thresholds
   * @returns {Promise<Array>} Sorted thresholds.
   */
  async setThresholds(guildId, thresholds) {
    for (const t of thresholds) {
      if (!Number.isInteger(t.count) || t.count < 1) {
        throw new Error("Warn count must be a positive integer");
      }
      if (!VALID_ACTIONS.includes(t.action)) {
        throw new Error(`Invalid action: ${t.action}`);
      }
      if (t.action === "timeout" && !t.duration) {
        throw new Error("Timeout requires a duration");
      }
      if (
        t.action === "timeout" &&
        (!Number.isInteger(t.duration) ||
          t.duration < 1 ||
          t.duration > MAX_TIMEOUT_MS)
      ) {
        throw new Error("Invalid timeout duration");
      }
    }
    const sorted = [...thresholds].sort((a, b) => a.count - b.count);
    await this.repo.setConfig(guildId, sorted);
    return sorted;
  }

  /**
   * Adds a new punishment threshold for a specific warning count.
   * @throws {Error} If action is invalid or count already exists.
   */
  async addThreshold(guildId, count, action, duration = null) {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("Warn count must be a positive integer");
    }
    if (!VALID_ACTIONS.includes(action))
      throw new Error(`Invalid action: ${action}`);
    if (action === "timeout" && !duration)
      throw new Error("Timeout requires a duration");
    if (
      action === "timeout" &&
      (!Number.isInteger(duration) || duration < 1 || duration > MAX_TIMEOUT_MS)
    ) {
      throw new Error("Invalid timeout duration");
    }

    const config = await this.getConfig(guildId);
    const exists = config.thresholds.find((t) => t.count === count);
    if (exists) throw new Error(`A threshold at ${count} warns already exists`);

    const entry = { count, action };
    if (action === "timeout" && duration) entry.duration = duration;

    const updated = [...config.thresholds, entry].sort(
      (a, b) => a.count - b.count,
    );
    await this.repo.setConfig(guildId, updated);
    return updated;
  }

  /**
   * Removes a punishment threshold by warn count.
   */
  async removeThreshold(guildId, count) {
    const config = await this.getConfig(guildId);
    const updated = config.thresholds.filter((t) => t.count !== count);
    if (updated.length === config.thresholds.length)
      throw new Error(`No threshold at ${count} warns`);
    await this.repo.setConfig(guildId, updated);
    return updated;
  }

  /**
   * Finds the highest applicable threshold for a given warning count.
   * @param {string} guildId
   * @param {number} warnCount
   * @returns {Promise<Object|null>}
   */
  async resolveThreshold(guildId, warnCount) {
    const config = await this.getConfig(guildId);
    if (!config.thresholds.length) return null;

    const sorted = [...config.thresholds].sort((a, b) => a.count - b.count);
    let matched = null;

    for (const t of sorted) {
      if (warnCount >= t.count) matched = t;
      else break;
    }

    return matched;
  }

  /**
   * Physically applies the Discord punishment (timeout, kick, ban).
   * @param {Object} guild - Discord.js Guild object.
   * @param {Object} member - Discord.js GuildMember object.
   * @param {Object} threshold - The threshold object to execute.
   * @param {string} reason - Original warning reason.
   * @returns {Promise<Object|null>} Details of the action taken.
   */
  async executePunishment(guild, member, threshold, reason) {
    const { action, duration } = threshold;
    const prefix = `Warn threshold reached (${threshold.count} warns) | `;
    const auditReason = `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);

    if (action === "timeout" && duration) {
      await member.timeout(duration, auditReason);
      return { action: "timeout", detail: this.formatDuration(duration) };
    }

    if (action === "kick") {
      await member.kick(auditReason);
      return { action: "kick", detail: null };
    }

    if (action === "ban") {
      await guild.members.ban(member.id, { reason: auditReason });
      return { action: "ban", detail: null };
    }

    return null;
  }
}
