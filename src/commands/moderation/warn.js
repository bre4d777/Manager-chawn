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
import { db } from "#dbManager";

const { colors } = config;

class WarnCommand extends Command {
  constructor() {
    super({
      name: "warn",
      description: "Warn a member",
      usage: "warn <user> [reason]",
      examples: ["warn @user", "warn @user spamming"],
      aliases: ["w"],
      cooldown: 5,
      permissions: [PermissionFlagsBits.ModerateMembers],
      userPermissions: [PermissionFlagsBits.ModerateMembers],
      enabledSlash: true,
      slashData: {
        name: ["mod", "warn"],
        description: "Warn a member",
        defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
        options: [
          {
            name: "user",
            description: "Member to warn",
            type: 6,
            required: true,
          },
          {
            name: "reason",
            description: "Reason for the warning",
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

    if (!ctx.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return ctx.reply({
        components: [_errorView("You do not have permission to warn members.")],
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
              "Please provide a member.\n\n**Usage:** `warn <user> [reason]`",
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

    if (target.id === ctx.user.id) {
      return ctx.reply({
        components: [_errorView("You cannot warn yourself.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (target.id === ctx.client.user.id) {
      return ctx.reply({
        components: [_errorView("I cannot be warned.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const targetMember = await ctx.guild.members
      .fetch(target.id)
      .catch(() => null);

    if (!targetMember) {
      return ctx.reply({
        components: [
          _errorView(`**${target.tag}** is not a member of this server.`),
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
            `You cannot warn **${target.tag}** — their role is higher than or equal to yours.`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }
    const warn = await db.warns.addWarn(
      ctx.guild.id,
      target.id,
      ctx.user.id,
      reason,
    );
    const warnCount = await db.warns.getWarnCount(ctx.guild.id, target.id);
    const threshold = await db.warns.resolveThreshold(ctx.guild.id, warnCount);

    let punishment = null;

    if (threshold && targetMember) {
      try {
        punishment = await db.warns.executePunishment(
          ctx.guild,
          targetMember,
          threshold,
          reason,
        );
      } catch {
        punishment = { action: threshold.action, failed: true };
      }
    }

    return ctx.reply({
      components: [
        _successView(target, ctx.user, reason, warn.id, warnCount, punishment),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _successView(target, executor, reason, warnId, warnCount, punishment) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.warning ?? 0xf39c12);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Member Warned"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );

  const lines = [
    `**User:** ${target.tag} \`(${target.id})\``,
    `**Warn #${warnId}** — Total: **${warnCount}** warn${warnCount === 1 ? "" : "s"}`,
    `**Moderator:** ${executor.tag} \`(${executor.id})\``,
    `**Reason:** ${reason}`,
  ];

  if (punishment && !punishment.failed) {
    const actionLabel =
      punishment.action === "timeout"
        ? `Timed out for ${punishment.detail}`
        : punishment.action === "kick"
          ? "Kicked"
          : "Banned";
    lines.push(`**Threshold Action:** ${actionLabel}`);
  } else if (punishment?.failed) {
    lines.push(
      `**Threshold Action:** Failed to execute (${punishment.action})`,
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );
  return container;
}

function _errorView(description) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.error ?? 0xe74c3c);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Warn Failed\n\n${description}`),
  );
  return container;
}

export default new WarnCommand();
