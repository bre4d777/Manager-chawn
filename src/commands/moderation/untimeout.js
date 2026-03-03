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
const MAX_AUDIT_REASON_LENGTH = 512;

class UntimeoutCommand extends Command {
  constructor() {
    super({
      name: "untimeout",
      description: "Remove a timeout from a member",
      usage: "untimeout <user> [reason]",
      examples: ["untimeout @user", "untimeout @user appeal accepted"],
      aliases: ["unmute", "removetimeout"],
      cooldown: 5,
      permissions: [PermissionFlagsBits.ModerateMembers],
      userPermissions: [PermissionFlagsBits.ModerateMembers],
      enabledSlash: true,
      slashData: {
        name: ["mod", "untimeout"],
        description: "Remove a timeout from a member",
        defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
        options: [
          {
            name: "user",
            description: "Member to remove timeout from",
            type: 6,
            required: true,
          },
          {
            name: "reason",
            description: "Reason for removing the timeout",
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

    const botMember = await ctx.guild.members.fetchMe().catch(() => {});

    if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return ctx.reply({
        components: [
          _errorView("I do not have permission to manage timeouts."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return ctx.reply({
        components: [
          _errorView("You do not have permission to manage timeouts."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let target, reason;

    if (ctx.isSlash) {
      target = ctx.options.getUser("user", true);
      reason = ctx.options.getString("reason") ?? "No reason provided";
    } else {
      const [rawUser, ...reasonParts] = ctx.args;

      if (!rawUser) {
        return ctx.reply({
          components: [
            _errorView(
              "Please provide a member.\n\n**Usage:** `untimeout <user> [reason]`",
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

      reason = reasonParts.join(" ").trim() || "No reason provided";
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

    if (
      !targetMember.communicationDisabledUntilTimestamp ||
      targetMember.communicationDisabledUntilTimestamp < Date.now()
    ) {
      return ctx.reply({
        components: [
          _errorView(`**${target.tag}** is not currently timed out.`),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!targetMember.moderatable) {
      return ctx.reply({
        components: [
          _errorView(
            `I cannot modify **${target.tag}**'s timeout — their role is too high.`,
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
            `You cannot modify **${target.tag}**'s timeout — their role is higher than or equal to yours.`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const auditReason = _buildAuditReason(ctx.user, "Untimeout", reason);
    try {
      await targetMember.timeout(null, auditReason);
    } catch (err) {
      return ctx.reply({
        components: [
          _errorView(
            `Failed to remove timeout from **${target.tag}**: ${err.message}`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    return ctx.reply({
      components: [_successView(target, ctx.user, reason)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _successView(target, executor, reason) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.success ?? 0x2ecc71);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Timeout Removed"),
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
    new TextDisplayBuilder().setContent(
      `## Untimeout Failed\n\n${description}`,
    ),
  );
  return container;
}
function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}
export default new UntimeoutCommand();
