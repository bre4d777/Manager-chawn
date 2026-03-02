import { WarnRepository } from '#dbRepo/warns';

const VALID_ACTIONS = ['timeout', 'kick', 'ban'];

const DURATION_UNITS = { s: 1, m: 60, h: 3_600, d: 86_400, w: 604_800 };
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1_000;

export class WarnService {
  constructor() {
    this.repo = new WarnRepository();
  }

  parseDuration(raw) {
    const match = String(raw).match(/^(\d+)(s|m|h|d|w)$/i);
    if (!match) return null;
    const ms = parseInt(match[1], 10) * (DURATION_UNITS[match[2].toLowerCase()] ?? 0) * 1_000;
    return ms > 0 && ms <= MAX_TIMEOUT_MS ? ms : null;
  }

  formatDuration(ms) {
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    const m = Math.floor((ms % 3_600_000)  / 60_000);
    const s = Math.floor((ms % 60_000)     / 1_000);
    return [d && `${d}d`, h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ');
  }
  async addWarn(guildId, userId, moderatorId, reason) {
    const warn = await this.repo.addWarn(guildId, userId, moderatorId, reason);
    return warn;
  }

  async getWarns(guildId, userId) {
    return await this.repo.getWarns(guildId, userId);
  }

  async getWarnCount(guildId, userId) {
    const warns = await this.repo.getWarns(guildId, userId);
    return warns.length;
  }

  async removeWarn(id, guildId, userId) {
    const warn = await this.repo.getWarnById(id);
    if (!warn || warn.guildId !== guildId) return false;
    await this.repo.removeWarn(id, guildId, userId);
    return true;
  }

  async clearWarns(guildId, userId) {
    await this.repo.clearWarns(guildId, userId);
  }

  async getConfig(guildId) {
    return await this.repo.getConfig(guildId);
  }

  async setThresholds(guildId, thresholds) {
    const sorted = [...thresholds].sort((a, b) => a.count - b.count);
    await this.repo.setConfig(guildId, sorted);
    return sorted;
  }

  async addThreshold(guildId, count, action, duration = null) {
    if (!VALID_ACTIONS.includes(action)) throw new Error(`Invalid action: ${action}`);
    if (action === 'timeout' && !duration) throw new Error('Timeout requires a duration');

    const config  = await this.getConfig(guildId);
    const exists  = config.thresholds.find((t) => t.count === count);
    if (exists) throw new Error(`A threshold at ${count} warns already exists`);

    const entry = { count, action };
    if (action === 'timeout' && duration) entry.duration = duration;

    const updated = [...config.thresholds, entry].sort((a, b) => a.count - b.count);
    await this.repo.setConfig(guildId, updated);
    return updated;
  }

  async removeThreshold(guildId, count) {
    const config  = await this.getConfig(guildId);
    const updated = config.thresholds.filter((t) => t.count !== count);
    if (updated.length === config.thresholds.length) throw new Error(`No threshold at ${count} warns`);
    await this.repo.setConfig(guildId, updated);
    return updated;
  }

  async clearThresholds(guildId) {
    await this.repo.setConfig(guildId, []);
  }

  async resolveThreshold(guildId, warnCount) {
    const config = await this.getConfig(guildId);
    if (!config.thresholds.length) return null;

    const sorted  = [...config.thresholds].sort((a, b) => a.count - b.count);
    let   matched = null;

    for (const t of sorted) {
      if (warnCount >= t.count) matched = t;
      else break;
    }

    return matched;
  }

  async executePunishment(guild, member, threshold, reason) {
    const { action, duration } = threshold;
    const auditReason = `Warn threshold reached (${threshold.count} warns) | ${reason}`;

    if (action === 'timeout' && duration) {
      await member.timeout(duration, auditReason);
      return { action: 'timeout', detail: this.formatDuration(duration) };
    }

    if (action === 'kick') {
      await member.kick(auditReason);
      return { action: 'kick', detail: null };
    }

    if (action === 'ban') {
      await guild.members.ban(member.id, { reason: auditReason });
      return { action: 'ban', detail: null };
    }

    return null;
  }
}