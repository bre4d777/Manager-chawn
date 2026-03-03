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

const MAX_SLOWMODE_S = 21_600;
const MAX_AUDIT_REASON_LENGTH = 512;
const DURATION_UNITS = { s: 1, m: 60, h: 3_600 };

function parseDuration(raw) {
  if (raw === "0" || raw.toLowerCase() === "off") return 0;
  const match = raw.match(/^(\d+)(s|m|h)$/i);
  if (!match) return null;
  const s =
    parseInt(match[1], 10) * (DURATION_UNITS[match[2].toLowerCase()] ?? 0);
  return s > 0 && s <= MAX_SLOWMODE_S ? s : null;
}

function formatDuration(s) {
  if (s === 0) return "Disabled";
  const h = Math.floor(s / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const rem = s % 60;
  return [h && `${h}h`, m && `${m}m`, rem && `${rem}s`]
    .filter(Boolean)
    .join(" ");
}

class SlowmodeCommand extends Command {
  constructor() {
    super({
      name: "slowmode",
      description: "Set or clear slowmode on a channel",
      usage: "slowmode <duration|0|off> [#channel] [reason]",
      examples: [
        "slowmode 10s",
        "slowmode 2m #general spam",
        "slowmode off",
        "slowmode 0 #general",
      ],
      aliases: ["slow", "ratelimit"],
      cooldown: 5,
      permissions: [PermissionFlagsBits.ManageChannels],
      userPermissions: [PermissionFlagsBits.ManageChannels],
      enabledSlash: true,
      slashData: {
        name: ["mod", "slowmode"],
        description: "Set or clear slowmode on a channel",
        defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
        options: [
          {
            name: "duration",
            description: "Delay e.g. 10s, 2m, 1h — or 0/off to disable (max 6h)",
            type: 3,
            required: true,
          },
          {
            name: "channel",
            description: "Channel to apply slowmode (defaults to current)",
            type: 7,
            required: false,
            channel_types: [0],
          },
          {
            name: "reason",
            description: "Reason for the change",
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
        components: [_errorView("Failed to resolve bot member in this server.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return ctx.reply({
        components: [_errorView("You do not have permission to manage channels.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let durationS, target, reason;

    if (ctx.isSlash) {
      const rawDur = ctx.options.getString("duration", true);
      durationS = parseDuration(rawDur);
      target = ctx.options.getChannel("channel") ?? ctx.channel;
      reason = ctx.options.getString("reason") ?? "No reason provided";
    } else {
      const [rawDur, ...rest] = ctx.args;

      if (!rawDur) {
        return ctx.reply({
          components: [
            _errorView(
              "Please provide a duration.\n\n**Usage:** `slowmode <duration|0|off> [#channel] [reason]`",
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      durationS = parseDuration(rawDur);

      const maybeChannel = rest[0];
      if (maybeChannel && /^<#\d+>$/.test(maybeChannel)) {
        const id = maybeChannel.replace(/\D/g, "");
        target = ctx.guild.channels.cache.get(id) ?? ctx.channel;
        reason = rest.slice(1).join(" ").trim() || "No reason provided";
      } else {
        target = ctx.channel;
        reason = rest.join(" ").trim() || "No reason provided";
      }
    }

    if (durationS === null) {
      return ctx.reply({
        components: [
          _errorView(
            "Invalid duration. Use formats like `10s`, `5m`, `1h`, or `0`/`off` to disable. Maximum is 6 hours.",
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!botMember.permissionsIn(target).has(PermissionFlagsBits.ManageChannels)) {
      return ctx.reply({
        components: [_errorView(`I do not have permission to manage ${target}.`)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const auditReason = _buildAuditReason(ctx.user, "Slowmode", reason);

    try {
      await target.setRateLimitPerUser(durationS, auditReason);
    } catch (err) {
      return ctx.reply({
        components: [
          _errorView(`Failed to set slowmode on ${target}: ${err.message}`),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    return ctx.reply({
      components: [_successView(target, ctx.user, durationS, reason)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _successView(channel, executor, durationS, reason) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.bot ?? 0x3498db);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      durationS === 0 ? "## Slowmode Disabled" : "## Slowmode Set",
    ),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Channel:** ${channel}`,
        `**Slowmode:** ${formatDuration(durationS)}`,
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
    new TextDisplayBuilder().setContent(`## Slowmode Failed\n\n${description}`),
  );
  return container;
}

function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}

export default new SlowmodeCommand();