import { Command } from "#command";
import {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  PermissionFlagsBits,
  PermissionOverwriteManager,
} from "discord.js";
import { config } from "#config";

const { colors } = config;

const MAX_AUDIT_REASON_LENGTH = 512;

class LockCommand extends Command {
  constructor() {
    super({
      name: "lock",
      description: "Prevent @everyone from sending messages in a channel",
      usage: "lock [#channel] [reason]",
      examples: [
        "lock",
        "lock #general raid incoming",
        "lock #announcements maintenance",
      ],
      aliases: ["lockdown"],
      cooldown: 5,
      permissions: [PermissionFlagsBits.ManageChannels],
      userPermissions: [PermissionFlagsBits.ManageChannels],
      enabledSlash: true,
      slashData: {
        name: ["mod", "lock"],
        description: "Prevent @everyone from sending messages in a channel",
        defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
        options: [
          {
            name: "channel",
            description: "Channel to lock (defaults to current)",
            type: 7,
            required: false,
            channel_types: [0],
          },
          {
            name: "reason",
            description: "Reason for locking",
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

    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return ctx.reply({
        components: [
          _errorView("You do not have permission to manage channels."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let target, reason;

    if (ctx.isSlash) {
      target = ctx.options.getChannel("channel") ?? ctx.channel;
      reason = ctx.options.getString("reason") ?? "No reason provided";
    } else {
      const [maybeChannel, ...rest] = ctx.args;

      if (maybeChannel && /^<#\d+>$/.test(maybeChannel)) {
        const id = maybeChannel.replace(/\D/g, "");
        target = ctx.guild.channels.cache.get(id) ?? ctx.channel;
        reason = rest.join(" ").trim() || "No reason provided";
      } else {
        target = ctx.channel;
        reason = ctx.args.join(" ").trim() || "No reason provided";
      }
    }
if (!target?.permissionOverwrites) {
     return ctx.reply({
        components: [
          _errorView("This channel type does not support permission overwrites."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }
    if (
      !botMember.permissionsIn(target).has(PermissionFlagsBits.ManageChannels)
    ) {
      return ctx.reply({
        components: [
          _errorView(`I do not have permission to manage ${target}.`),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (
      !ctx.member.permissionsIn(target).has(PermissionFlagsBits.ManageChannels)
    ) {
      return ctx.reply({
        components: [
          _errorView(`You do not have permission to manage ${target}.`),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const everyoneId = ctx.guild.roles.everyone.id;
    const existing = target.permissionOverwrites.cache.get(everyoneId);

    if (existing?.deny.has(PermissionFlagsBits.SendMessages)) {
      return ctx.reply({
        components: [_errorView(`${target} is already locked.`)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const auditReason = _buildAuditReason(ctx.user, "Lock", reason);

    try {
      await target.permissionOverwrites.edit(
        everyoneId,
        { SendMessages: false },
        { reason: auditReason },
      );
    } catch (err) {
      return ctx.reply({
        components: [_errorView(`Failed to lock ${target}: ${err.message}`)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    return ctx.reply({
      components: [_successView(target, ctx.user, reason)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _successView(channel, executor, reason) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.error ?? 0xe74c3c);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Channel Locked"),
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
    new TextDisplayBuilder().setContent(`## Lock Failed\n\n${description}`),
  );
  return container;
}

function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}

export default new LockCommand();
