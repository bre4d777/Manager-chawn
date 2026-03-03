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

class UnbanCommand extends Command {
  constructor() {
    super({
      name: "unban",
      description: "Unban a user by ID",
      usage: "unban <userId> [reason]",
      examples: [
        "unban 123456789012345678",
        "unban 123456789012345678 appeal accepted",
      ],
      cooldown: 5,
      permissions: [PermissionFlagsBits.BanMembers],
      userPermissions: [PermissionFlagsBits.BanMembers],
      enabledSlash: true,
      slashData: {
        name: ["mod", "unban"],
        description: "Unban a user by ID",
        defaultMemberPermissions: PermissionFlagsBits.BanMembers,
        options: [
          {
            name: "user_id",
            description: "The Discord user ID to unban",
            type: 3,
            required: true,
          },
          {
            name: "reason",
            description: "Reason for the unban",
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

    const botMember = await ctx.guild.members.fetchMe();

    if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
      return ctx.reply({
        components: [_errorView("I do not have permission to unban members.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return ctx.reply({
        components: [
          _errorView("You do not have permission to unban members."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let rawId, reason;

    if (ctx.isSlash) {
      rawId = ctx.options.getString("user_id", true).trim();
      reason = ctx.options.getString("reason") ?? "No reason provided";
    } else {
      const [id, ...reasonParts] = ctx.args;

      if (!id) {
        return ctx.reply({
          components: [
            _errorView(
              "Please provide a user ID.\n\n**Usage:** `unban <userId> [reason]`",
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      rawId = id.trim();
      reason = reasonParts.join(" ").trim() || "No reason provided";
    }

    if (!/^\d{17,20}$/.test(rawId)) {
      return ctx.reply({
        components: [
          _errorView(`\`${rawId}\` is not a valid Discord user ID.`),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const banEntry = await ctx.guild.bans.fetch(rawId).catch(() => null);

    if (!banEntry) {
      return ctx.reply({
        components: [
          _errorView(`No active ban found for user ID \`${rawId}\`.`),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const auditReason = _buildAuditReason(ctx.user, "Unban", reason);
    try {
      await ctx.guild.members.unban(rawId, auditReason);
    } catch (err) {
      return ctx.reply({
        components: [
          _errorView(`Failed to unban \`${rawId}\`: ${err.message}`),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    return ctx.reply({
      components: [
        _successView(banEntry.user, ctx.user, reason, banEntry.reason),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _successView(target, executor, reason, originalReason) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.success ?? 0x2ecc71);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## User Unbanned"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );

  const lines = [
    `**User:** ${target.tag} \`(${target.id})\``,
    originalReason ? `**Original Ban Reason:** ${originalReason}` : null,
    `**Moderator:** ${executor.tag} \`(${executor.id})\``,
    `**Reason:** ${reason}`,
  ].filter(Boolean);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );
  return container;
}

function _errorView(description) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.error ?? 0xe74c3c);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Unban Failed\n\n${description}`),
  );
  return container;
}
function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}

export default new UnbanCommand();
