import { Command } from "#command";
import {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  PermissionFlagsBits,
} from "discord.js";
import { config } from "#config";

const { colors } = config;

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1_000;
const MAX_AUDIT_REASON_LENGTH = 512;
const DURATION_UNITS = { s: 1, m: 60, h: 3_600, d: 86_400, w: 604_800 };

function parseDuration(raw) {
  const match = raw.match(/^(\d+)(s|m|h|d|w)$/i);
  if (!match) return null;
  const ms =
    parseInt(match[1], 10) *
    (DURATION_UNITS[match[2].toLowerCase()] ?? 0) *
    1_000;
  return ms > 0 && ms <= MAX_TIMEOUT_MS ? ms : null;
}

function formatDuration(ms) {
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, s && `${s}s`]
    .filter(Boolean)
    .join(" ");
}

class TimeoutCommand extends Command {
  constructor() {
    super({
      name: "timeout",
      description: "Timeout a member (1s–28d)",
      usage: "timeout <user> <duration> [reason]",
      examples: [
        "timeout @user 10m",
        "timeout @user 2h spam",
        "timeout @user 1d raid",
      ],
      aliases: ["mute", "silence", "to"],
      cooldown: 5,
      permissions: [PermissionFlagsBits.ModerateMembers],
      userPermissions: [PermissionFlagsBits.ModerateMembers],
      enabledSlash: true,
      slashData: {
        name: ["mod", "timeout"],
        description: "Timeout a member (1s–28d)",
        defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
        options: [
          {
            name: "user",
            description: "Member to timeout",
            type: 6,
            required: true,
          },
          {
            name: "duration",
            description: "Duration e.g. 10m, 2h, 1d, 1w (max 28d)",
            type: 3,
            required: true,
          },
          {
            name: "reason",
            description: "Reason for the timeout",
            type: 3,
            required: false,
          },
        ],
      },
    });
  }

  async execute({ ctx }) {
    if (!ctx.inGuild()) {
      return ctx.reply({
        components: [_errorView("This command can only be used in a server.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const botMember = await ctx.guild.members.fetchMe().catch(() => null);
    if (!botMember) {
      return ctx.reply({
        components: [
          _errorView("Failed to resolve bot member in this server."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return ctx.reply({
        components: [
          _errorView("I do not have permission to timeout members."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return ctx.reply({
        components: [
          _errorView("You do not have permission to timeout members."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let target, durationMs, reason;

    if (ctx.isSlash) {
      target = ctx.options.getUser("user", true);
      durationMs = parseDuration(ctx.options.getString("duration", true));
      reason = ctx.options.getString("reason") ?? "No reason provided";
    } else {
      const [rawUser, rawDur, ...reasonParts] = ctx.args;

      if (!rawUser) {
        return ctx.reply({
          components: [
            _errorView(
              "Please provide a member.\n\n**Usage:** `timeout <user> <duration> [reason]`",
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      if (!rawDur) {
        return ctx.reply({
          components: [
            _errorView(
              "Please provide a duration (e.g. `10m`, `2h`, `1d`, `1w`).",
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      target = await ctx.client.users
        .fetch(rawUser.replace(/\D/g, ""))
        .catch(() => null);
      if (!target) {
        return ctx.reply({
          components: [_errorView(`Could not find user \`${rawUser}\`.`)],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      durationMs = parseDuration(rawDur);
      reason = reasonParts.join(" ").trim() || "No reason provided";
    }

    if (!durationMs) {
      return ctx.reply({
        components: [
          _errorView(
            "Invalid duration. Use formats like `10m`, `2h`, `1d`, `1w`. Maximum is 28 days.",
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (target.id === ctx.user.id) {
      return ctx.reply({
        components: [_errorView("You cannot timeout yourself.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (target.id === ctx.client.user.id) {
      return ctx.reply({
        components: [_errorView("I cannot timeout myself.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const targetMember = await ctx.guild.members
      .fetch(target.id)
      .catch(() => null);

    if (!targetMember) {
      return ctx.reply({
        components: [_errorView(`**${target.tag}** is not in this server.`)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!targetMember.moderatable) {
      return ctx.reply({
        components: [
          _errorView(
            `I cannot timeout **${target.tag}** — their role is too high.`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const execHighest = ctx.member.roles?.highest?.position ?? 0;
    const targetHighest = targetMember.roles?.highest?.position ?? 0;

    if (execHighest <= targetHighest && ctx.guild.ownerId !== ctx.user.id) {
      return ctx.reply({
        components: [
          _errorView(
            `You cannot timeout **${target.tag}** — their role is higher than or equal to yours.`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const until = new Date(Date.now() + durationMs);
    const auditReason = _buildAuditReason(ctx.user, "Timeout", reason);

    try {
      await targetMember.timeout(durationMs, auditReason);
    } catch (err) {
      return ctx.reply({
        components: [
          _errorView(`Failed to timeout **${target.tag}**: ${err.message}`),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    return ctx.reply({
      components: [_successView(target, ctx.user, reason, durationMs, until)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _successView(target, executor, reason, durationMs, until) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.warning ?? 0xf39c12);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Member Timed Out"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**User:** ${target.tag} \`(${target.id})\``,
        `**Duration:** ${formatDuration(durationMs)}`,
        `**Expires:** <t:${Math.floor(until.getTime() / 1_000)}:R>`,
        `**Moderator:** ${executor.tag} \`(${executor.id})\``,
        `**Reason:** ${reason}`,
      ].join("\n"),
    ),
  );
  return container;
}

function _errorView(description) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.error ?? 0xe74c3c);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Timeout Failed\n\n${description}`),
  );
  return container;
}
function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}

export default new TimeoutCommand();
