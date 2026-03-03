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

class RoleAddCommand extends Command {
  constructor() {
    super({
      name: "roleadd",
      description: "Add a role to a member",
      usage: "roleadd <user> <role> [reason]",
      examples: [
        "roleadd @user @Member",
        "roleadd @user @Verified passed verification",
        "roleadd 123456789 @Muted",
      ],
      aliases: ["addrole", "giverole"],
      cooldown: 5,
      permissions: [PermissionFlagsBits.ManageRoles],
      userPermissions: [PermissionFlagsBits.ManageRoles],
      enabledSlash: true,
      slashData: {
        name: ["role", "add"],
        description: "Add a role to a member",
        defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
        options: [
          {
            name: "user",
            description: "Member to assign the role to",
            type: 6,
            required: true,
          },
          {
            name: "role",
            description: "Role to assign",
            type: 8,
            required: true,
          },
          {
            name: "reason",
            description: "Reason for assigning the role",
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

    let target, role, reason;

    if (ctx.isSlash) {
      target = ctx.options.getUser("user", true);
      role = ctx.options.getRole("role", true);
      reason = ctx.options.getString("reason") ?? "No reason provided";
    } else {
      const [rawUser, rawRole, ...reasonParts] = ctx.args;

      if (!rawUser || !rawRole) {
        return ctx.reply({
          components: [
            _errorView(
              "Please provide a user and role.\n\n**Usage:** `roleadd <user> <role> [reason]`",
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      target = await ctx.client.users
        .fetch(rawUser.replace(/[<@!>]/g, ""))
        .catch(() => null);

      if (!target) {
        return ctx.reply({
          components: [_errorView(`Could not find user \`${rawUser}\`.`)],
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

    if (role.managed) {
      return ctx.reply({
        components: [
          _errorView(
            "Managed roles (bot/integration roles) cannot be manually assigned.",
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (role.id === ctx.guild.roles.everyone.id) {
      return ctx.reply({
        components: [_errorView("The @everyone role cannot be assigned.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (role.position >= botMember.roles.highest.position) {
      return ctx.reply({
        components: [
          _errorView(
            `I cannot assign ${role} — it is higher than or equal to my highest role.`,
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
            `You cannot assign ${role} — it is higher than or equal to your highest role.`,
          ),
        ],
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

    if (targetMember.roles.cache.has(role.id)) {
      return ctx.reply({
        components: [_errorView(`**${target.tag}** already has ${role}.`)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const auditReason = _buildAuditReason(ctx.user, "RoleAdd", reason);

    try {
      await targetMember.roles.add(role, auditReason);
    } catch (err) {
      return ctx.reply({
        components: [
          _errorView(
            `Failed to add ${role} to **${target.tag}**: ${err.message}`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    return ctx.reply({
      components: [_successView(target, role, ctx.user, reason)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _successView(target, role, executor, reason) {
  const container = new ContainerBuilder();
  container.setAccentColor(role.color || (colors.success ?? 0x2ecc71));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Role Added"),
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
        `**Role:** ${role} \`(${role.id})\``,
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
    new TextDisplayBuilder().setContent(`## Role Add Failed\n\n${description}`),
  );
  return container;
}

function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}

export default new RoleAddCommand();
