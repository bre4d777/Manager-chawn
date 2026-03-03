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

class RoleCreateCommand extends Command {
  constructor() {
    super({
      name: "rolecreate",
      description:
        "Create a new role with optional color, hoist, and mentionable settings",
      usage:
        "rolecreate <name> [--color #hex] [--hoist] [--mentionable] [--reason text]",
      examples: [
        "rolecreate Members",
        "rolecreate VIP --color #f1c40f --hoist",
        "rolecreate Announcements --mentionable --color #e74c3c",
        "rolecreate Moderator --hoist --mentionable --reason staff restructure",
      ],
      aliases: ["createrole", "newrole", "mkrele"],
      cooldown: 10,
      permissions: [PermissionFlagsBits.ManageRoles],
      userPermissions: [PermissionFlagsBits.ManageRoles],
      enabledSlash: true,
      slashData: {
        name: ["role", "create"],
        description: "Create a new role",
        defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
        options: [
          {
            name: "name",
            description: "Name for the new role",
            type: 3,
            required: true,
          },
          {
            name: "color",
            description: "Role color as a hex code e.g. #f1c40f",
            type: 3,
            required: false,
          },
          {
            name: "hoist",
            description: "Display the role separately in the member list",
            type: 5,
            required: false,
          },
          {
            name: "mentionable",
            description: "Allow anyone to @mention this role",
            type: 5,
            required: false,
          },
          {
            name: "reason",
            description: "Reason for creating the role",
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

    let name, color, hoist, mentionable, reason;

    if (ctx.isSlash) {
      name = ctx.options.getString("name", true).trim();
      color = ctx.options.getString("color") ?? null;
      hoist = ctx.options.getBoolean("hoist") ?? false;
      mentionable = ctx.options.getBoolean("mentionable") ?? false;
      reason = ctx.options.getString("reason") ?? "No reason provided";
    } else {
      const parsed = _parsePrefixArgs(ctx.args);
      if (parsed.error) {
        return ctx.reply({
          components: [_errorView(parsed.error)],
          flags: MessageFlags.IsComponentsV2,
        });
      }
      name = parsed.name;
      color = parsed.color ?? null;
      hoist = parsed.hoist;
      mentionable = parsed.mentionable;
      reason = parsed.reason;
    }

    if (!name || name.length > 100) {
      return ctx.reply({
        components: [
          _errorView("Role name must be between 1 and 100 characters."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let resolvedColor = null;
    if (color) {
      resolvedColor = _parseColor(color);
      if (resolvedColor === null) {
        return ctx.reply({
          components: [
            _errorView(
              `Invalid color \`${color}\`. Use a hex code like \`#f1c40f\` or \`f1c40f\`.`,
            ),
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
      }
    }

    const auditReason = _buildAuditReason(ctx.user, "RoleCreate", reason);

    const options = {
      name,
      hoist,
      mentionable,
      reason: auditReason,
    };

    if (resolvedColor !== null) options.color = resolvedColor;

    let role;
    try {
      role = await ctx.guild.roles.create(options);
    } catch (err) {
      return ctx.reply({
        components: [_errorView(`Failed to create role: ${err.message}`)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    return ctx.reply({
      components: [_successView(role, ctx.user, reason)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _parsePrefixArgs(args) {
  if (!args.length) {
    return {
      error:
        "Please provide a role name.\n\n**Usage:** `rolecreate <name> [--color #hex] [--hoist] [--mentionable] [--reason text]`",
    };
  }

  const nameParts = [];
  let color = null;
  let hoist = false;
  let mentionable = false;
  const reasonParts = [];
  let i = 0;

  while (i < args.length) {
    const tok = args[i];
    if (tok === "--color") {
      const next = args[i + 1];
      if (!next || next.startsWith("--"))
        return { error: "Missing value for `--color`." };
      color = next;
      i += 2;
    } else if (tok === "--hoist") {
      hoist = true;
      i++;
    } else if (tok === "--mentionable") {
      mentionable = true;
      i++;
    } else if (tok === "--reason") {
      reasonParts.push(...args.slice(i + 1));
      i = args.length;
    } else if (!tok.startsWith("--")) {
      nameParts.push(tok);
      i++;
    } else {
      i++;
    }
  }

  const name = nameParts.join(" ").trim();
  if (!name) return { error: "Please provide a role name." };

  return {
    name,
    color,
    hoist,
    mentionable,
    reason: reasonParts.join(" ").trim() || "No reason provided",
  };
}

function _parseColor(raw) {
  const cleaned = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return parseInt(cleaned, 16);
}

function _successView(role, executor, reason) {
  const container = new ContainerBuilder();
  container.setAccentColor(role.color || (colors.success ?? 0x2ecc71));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Role Created"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Role:** ${role} \`(${role.id})\``,
        `**Color:** ${role.color ? `#${role.color.toString(16).padStart(6, "0").toUpperCase()}` : "Default"}`,
        `**Hoisted:** ${role.hoist ? "Yes" : "No"}`,
        `**Mentionable:** ${role.mentionable ? "Yes" : "No"}`,
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
      `## Role Create Failed\n\n${description}`,
    ),
  );
  return container;
}

function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}

export default new RoleCreateCommand();
