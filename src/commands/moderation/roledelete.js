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

class RoleDeleteCommand extends Command {
  constructor() {
    super({
      name: "roledelete",
      description: "Permanently delete a role from the server",
      usage: "roledelete <@role|id> [reason]",
      examples: [
        "roledelete @OldRole",
        "roledelete @Muted no longer needed",
        "roledelete 123456789012345678 cleanup",
      ],
      aliases: ["delrole", "removerole", "drole"],
      cooldown: 10,
      permissions: [PermissionFlagsBits.ManageRoles],
      userPermissions: [PermissionFlagsBits.ManageRoles],
      enabledSlash: true,
      slashData: {
        name: ["role", "delete"],
        description: "Permanently delete a role from the server",
        defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
        options: [
          {
            name: "role",
            description: "Role to delete",
            type: 8,
            required: true,
          },
          {
            name: "reason",
            description: "Reason for deleting the role",
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

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return ctx.reply({
        components: [_errorView("I do not have permission to manage roles.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return ctx.reply({
        components: [_errorView("You do not have permission to manage roles.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let role, reason;

    if (ctx.isSlash) {
      role = ctx.options.getRole("role", true);
      reason = ctx.options.getString("reason") ?? "No reason provided";
    } else {
      const [rawRole, ...reasonParts] = ctx.args;

      if (!rawRole) {
        return ctx.reply({
          components: [
            _errorView(
              "Please provide a role.\n\n**Usage:** `roledelete <@role|id> [reason]`",
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      const roleId = rawRole.replace(/[<@&>]/g, "");
      role = ctx.guild.roles.cache.get(roleId);

      if (!role) {
        return ctx.reply({
          components: [_errorView(`Could not find role \`${rawRole}\`.`)],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      reason = reasonParts.join(" ").trim() || "No reason provided";
    }

    if (role.id === ctx.guild.roles.everyone.id) {
      return ctx.reply({
        components: [_errorView("The @everyone role cannot be deleted.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (role.managed) {
      return ctx.reply({
        components: [
          _errorView(
            `**${role.name}** is a managed role (bot/integration) and cannot be deleted manually.`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (role.position >= botMember.roles.highest.position) {
      return ctx.reply({
        components: [
          _errorView(
            `I cannot delete **${role.name}** — it is higher than or equal to my highest role.`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const execHighest = ctx.member.roles?.highest?.position ?? 0;
    if (role.position >= execHighest && ctx.guild.ownerId !== ctx.user.id) {
      return ctx.reply({
        components: [
          _errorView(
            `You cannot delete **${role.name}** — it is higher than or equal to your highest role.`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const roleName = role.name;
    const roleId = role.id;
    const roleColor = role.color;
    const memberCount = role.members.size;

    const auditReason = _buildAuditReason(ctx.user, "RoleDelete", reason);

    try {
      await role.delete(auditReason);
    } catch (err) {
      return ctx.reply({
        components: [_errorView(`Failed to delete role: Check role hierarchy and bot permissions`)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    return ctx.reply({
      components: [
        _successView(
          roleName,
          roleId,
          roleColor,
          memberCount,
          ctx.user,
          reason,
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _successView(
  roleName,
  roleId,
  roleColor,
  memberCount,
  executor,
  reason,
) {
  const container = new ContainerBuilder();
  container.setAccentColor(roleColor || (colors.success ?? 0x2ecc71));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Role Deleted"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Role:** ${roleName} \`(${roleId})\``,
        `**Had Members:** ${memberCount}`,
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
      `## Role Delete Failed\n\n${description}`,
    ),
  );
  return container;
}

function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}

export default new RoleDeleteCommand();
