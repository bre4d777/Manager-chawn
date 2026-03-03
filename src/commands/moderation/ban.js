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
const DEFAULT_DELETE_DAYS = 0;

class BanCommand extends Command {
  constructor() {
    super({
      name: "ban",
      description: "Ban a member from the server",
      usage: "ban <user> [days] [reason]",
      examples: [
        "ban @user",
        "ban @user 7 spamming",
        "ban 123456789 1 rule violation",
      ],
      cooldown: 5,
      permissions: [PermissionFlagsBits.BanMembers],
      userPermissions: [PermissionFlagsBits.BanMembers],
      enabledSlash: true,
      slashData: {
        name: ["mod", "ban"],
        description: "Ban a member from the server",
        defaultMemberPermissions: PermissionFlagsBits.BanMembers,
        options: [
          {
            name: "user",
            description: "The user to ban",
            type: 6,
            required: true,
          },
          {
            name: "days",
            description: `Days of messages to delete (0-${MAX_DELETE_DAYS}, default ${DEFAULT_DELETE_DAYS})`,
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
        components: [
          this._errorView("This command can only be used in a server."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const botMember = await ctx.guild.members.fetchMe();

    if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
      return ctx.reply({
        components: [
          this._errorView("I do not have permission to ban members."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return ctx.reply({
        components: [
          this._errorView("You do not have permission to ban members."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let target, deleteMessageDays, reason;

    if (ctx.isSlash) {
      target = ctx.options.getUser("user", true);
      deleteMessageDays = ctx.options.getInteger("days") ?? DEFAULT_DELETE_DAYS;
      reason = ctx.options.getString("reason") ?? "No reason provided";
    } else {
      const [rawTarget, rawDays, ...reasonParts] = ctx.args;

      if (!rawTarget) {
        return ctx.reply({
          components: [
            this._errorView(
              "Please provide a user to ban.\n\n**Usage:** `/mod ban <user> [days] [reason]`",
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      const userId = rawTarget.replace(/[<@!>]/g, "");
      try {
        target = await ctx.client.users.fetch(userId);
      } catch {
        return ctx.reply({
          components: [
            this._errorView(
              `Could not find a user with ID or mention \`${rawTarget}\`.`,
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      const parsedDays = parseInt(rawDays, 10);
      if (rawDays && isNaN(parsedDays)) {
        reasonParts.unshift(rawDays);
        deleteMessageDays = DEFAULT_DELETE_DAYS;
      } else {
        deleteMessageDays = Math.min(
          Math.max(parsedDays || DEFAULT_DELETE_DAYS, 0),
          MAX_DELETE_DAYS,
        );
      }

      reason = reasonParts.join(" ").trim() || "No reason provided";
    }

    if (target.id === ctx.user.id) {
      return ctx.reply({
        components: [this._errorView("You cannot ban yourself.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (target.id === ctx.client.user.id) {
      return ctx.reply({
        components: [this._errorView("I cannot ban myself.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const targetMember = await ctx.guild.members
      .fetch(target.id)
      .catch(() => null);

    if (targetMember) {
      if (!targetMember.bannable) {
        return ctx.reply({
          components: [
            this._errorView(
              `I cannot ban **${target.tag}** — their role is higher than or equal to mine.`,
            ),
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
      }

      const executorHighest = ctx.member.roles?.highest?.position ?? 0;
      const targetHighest = targetMember.roles?.highest?.position ?? 0;

      if (
        executorHighest <= targetHighest &&
        ctx.guild.ownerId !== ctx.user.id
      ) {
        return ctx.reply({
          components: [
            this._errorView(
              `You cannot ban **${target.tag}** — their role is higher than or equal to yours.`,
            ),
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
      }
    }

    const alreadyBanned = await ctx.guild.bans
      .fetch(target.id)
      .catch(() => null);
    if (alreadyBanned) {
      return ctx.reply({
        components: [
          this._errorView(
            `**${target.tag}** is already banned from this server.`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const auditReason = _buildAuditReason(ctx.user, "Ban", reason);

    try {
      await ctx.guild.members.ban(target.id, {
        deleteMessageSeconds: deleteMessageDays * 86_400,
        reason: auditReason,
      });
    } catch (err) {
      return ctx.reply({
        components: [
          this._errorView(`Failed to ban **${target.tag}**: ${err.message}`),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    await ctx.reply({
      components: [
        this._successView(target, ctx.user, reason, deleteMessageDays),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  _successView(target, executor, reason, days) {
    const container = new ContainerBuilder();
    container.setAccentColor(colors.success ?? 0x2ecc71);

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Member Banned`),
    );

    container.addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true),
    );

    const lines = [
      `**User:** ${target.tag} \`(${target.id})\``,
      `**Moderator:** ${executor.tag}`,
      `**Reason:** ${reason}`,
      `**Messages Deleted:** ${days === 0 ? "None" : `${days} day${days === 1 ? "" : "s"}`}`,
    ];

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join("\n")),
    );

    return container;
  }

  _errorView(description) {
    const container = new ContainerBuilder();
    container.setAccentColor(colors.error ?? 0xe74c3c);

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Ban Failed\n\n${description}`),
    );

    return container;
  }
}

function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}

export default new BanCommand();
