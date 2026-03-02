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

const MAX_DELETE_DAYS = 7;

class HackbanCommand extends Command {
  constructor() {
    super({
      name: "hackban",
      description: "Ban a user by ID without them being in the server",
      usage: "hackban <userId> [days] [reason]",
      examples: [
        "hackban 123456789012345678",
        "hackban 123456789012345678 7 raid",
        "hackban 123456789012345678 0 pre-emptive",
      ],
      aliases: ["forceban", "idban"],
      cooldown: 5,
      permissions: [PermissionFlagsBits.BanMembers],
      userPermissions: [PermissionFlagsBits.BanMembers],
      enabledSlash: true,
      slashData: {
        name: ["mod", "hackban"],
        description: "Ban a user by ID (does not need to be in the server)",
        defaultMemberPermissions: PermissionFlagsBits.BanMembers,
        options: [
          {
            name: "user_id",
            description: "The Discord user ID to ban",
            type: 3,
            required: true,
          },
          {
            name: "days",
            description: `Days of messages to delete (0–${MAX_DELETE_DAYS})`,
            type: 4,
            required: false,
            min_value: 0,
            max_value: MAX_DELETE_DAYS,
          },
          {
            name: "reason",
            description: "Reason for the ban",
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
        components: [_errorView("I do not have permission to ban members.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return ctx.reply({
        components: [_errorView("You do not have permission to ban members.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let rawId, deleteMessageDays, reason;

    if (ctx.isSlash) {
      rawId = ctx.options.getString("user_id", true).trim();
      deleteMessageDays = ctx.options.getInteger("days") ?? 0;
      reason = ctx.options.getString("reason") ?? "No reason provided";
    } else {
      const [id, rawDays, ...reasonParts] = ctx.args;

      if (!id) {
        return ctx.reply({
          components: [
            _errorView(
              "Please provide a user ID.\n\n**Usage:** `hackban <userId> [days] [reason]`",
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      rawId = id.trim();

      const parsedDays = parseInt(rawDays, 10);
      if (rawDays && isNaN(parsedDays)) {
        reasonParts.unshift(rawDays);
        deleteMessageDays = 0;
      } else {
        deleteMessageDays = Math.min(
          Math.max(parsedDays || 0, 0),
          MAX_DELETE_DAYS,
        );
      }

      reason = reasonParts.join(" ").trim() || "No reason provided";
    }

    if (!/^\d{17,20}$/.test(rawId)) {
      return ctx.reply({
        components: [
          _errorView(
            `\`${rawId}\` is not a valid Discord user ID. IDs are 17–20 digits.`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (rawId === ctx.user.id) {
      return ctx.reply({
        components: [_errorView("You cannot ban yourself.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (rawId === ctx.client.user.id) {
      return ctx.reply({
        components: [_errorView("I cannot ban myself.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const existingBan = await ctx.guild.bans.fetch(rawId).catch(() => null);
    if (existingBan) {
      return ctx.reply({
        components: [
          _errorView(`User \`${rawId}\` is already banned from this server.`),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const targetMember = await ctx.guild.members.fetch(rawId).catch(() => null);
    if (targetMember) {
      if (!targetMember.bannable) {
        return ctx.reply({
          components: [
            _errorView(`I cannot ban <@${rawId}> — their role is too high.`),
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
              `You cannot ban <@${rawId}> — their role is higher than or equal to yours.`,
            ),
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
      }
    }

    const resolvedUser = await ctx.client.users.fetch(rawId).catch(() => null);
    const auditReason = `Hackbanned by ${ctx.user.tag} (${ctx.user.id}) | ${reason}`;

    try {
      await ctx.guild.members.ban(rawId, {
        deleteMessageSeconds: deleteMessageDays * 86_400,
        reason: auditReason,
      });
    } catch (err) {
      return ctx.reply({
        components: [_errorView(`Failed to ban \`${rawId}\`: ${err.message}`)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    return ctx.reply({
      components: [
        _successView(resolvedUser, rawId, ctx.user, reason, deleteMessageDays),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _successView(resolvedUser, rawId, executor, reason, days) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.success ?? 0x2ecc71);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## User Hackbanned"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );

  const lines = [
    resolvedUser
      ? `**User:** ${resolvedUser.tag} \`(${rawId})\``
      : `**User ID:** \`${rawId}\``,
    `**Messages Deleted:** ${days === 0 ? "None" : `${days} day${days === 1 ? "" : "s"}`}`,
    `**Moderator:** ${executor.tag} \`(${executor.id})\``,
    `**Reason:** ${reason}`,
  ];

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );
  return container;
}

function _errorView(description) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.error ?? 0xe74c3c);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Hackban Failed\n\n${description}`),
  );
  return container;
}

export default new HackbanCommand();
