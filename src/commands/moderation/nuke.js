import { Command } from "#command";
import {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import { config } from "#config";

const { colors } = config;

const MAX_AUDIT_REASON_LENGTH = 512;

class NukeCommand extends Command {
  constructor() {
    super({
      name: "nuke",
      description: "Clone a channel and delete the original, wiping all messages",
      usage: "nuke [#channel] [reason]",
      examples: [
        "nuke",
        "nuke #general raid cleanup",
        "nuke #spam",
      ],
      aliases: ["clearchannel", "channelnuke"],
      cooldown: 30,
      permissions: [PermissionFlagsBits.ManageChannels],
      userPermissions: [PermissionFlagsBits.ManageChannels],
      enabledSlash: true,
      slashData: {
        name: ["mod", "nuke"],
        description: "Clone a channel and delete the original, wiping all messages",
        defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
        options: [
          {
            name: "channel",
            description: "Channel to nuke (defaults to current)",
            type: 7,
            required: false,
            channel_types: [0, 5],
          },
          {
            name: "reason",
            description: "Reason for nuking",
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

    const allowed = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
    if (!allowed.includes(target.type)) {
      return ctx.reply({
        components: [_errorView("Only text and announcement channels can be nuked.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!botMember.permissionsIn(target).has(PermissionFlagsBits.ManageChannels)) {
      return ctx.reply({
        components: [_errorView(`I do not have permission to manage ${target}.`)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    await ctx.deferReply({ ephemeral: true });

    const auditReason = _buildAuditReason(ctx.user, "Nuke", reason);

    let newChannel;
    try {
      newChannel = await target.clone({ reason: auditReason });
      await newChannel.setPosition(target.rawPosition, { reason: auditReason });
    } catch (err) {
      return ctx.editReply({
        components: [_errorView(`Failed to clone channel: ${err.message}`)],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    try {
      await target.delete(auditReason);
    } catch (err) {
      await newChannel.delete().catch(() => {});
      return ctx.editReply({
        components: [_errorView(`Failed to delete original channel: ${err.message}`)],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    await ctx.editReply({
      components: [_successView(newChannel, ctx.user, reason)],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});

    await newChannel.send({
      components: [_successView(newChannel, ctx.user, reason)],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
  }
}

function _successView(channel, executor, reason) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.success ?? 0x2ecc71);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Channel Nuked"),
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
    new TextDisplayBuilder().setContent(`## Nuke Failed\n\n${description}`),
  );
  return container;
}

function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}

export default new NukeCommand();