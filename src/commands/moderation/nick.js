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

const MAX_NICK_LENGTH = 32;

class NicknameCommand extends Command {
  constructor() {
    super({
      name: "nickname",
      description: "Set, change, or reset a member's nickname",
      usage: "nickname <user> [nickname]",
      examples: ["nickname @user CoolName", "nickname @user"],
      aliases: ["nick", "setnick"],
      cooldown: 5,
      permissions: [PermissionFlagsBits.ManageNicknames],
      userPermissions: [PermissionFlagsBits.ManageNicknames],
      enabledSlash: true,
      slashData: {
        name: ["mod", "nickname"],
        description: "Set, change, or reset a member's nickname",
        defaultMemberPermissions: PermissionFlagsBits.ManageNicknames,
        options: [
          {
            name: "user",
            description: "Member to change nickname for",
            type: 6,
            required: true,
          },
          {
            name: "nickname",
            description: "New nickname (leave blank to reset)",
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

    if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return ctx.reply({
        components: [
          _errorView("I do not have permission to manage nicknames."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return ctx.reply({
        components: [
          _errorView("You do not have permission to manage nicknames."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let target, newNick;

    if (ctx.isSlash) {
      target = ctx.options.getUser("user", true);
      newNick = ctx.options.getString("nickname") ?? null;
    } else {
      const [rawUser, ...nickParts] = ctx.args;

      if (!rawUser) {
        return ctx.reply({
          components: [
            _errorView(
              "Please provide a member.\n\n**Usage:** `nickname <user> [nickname]`",
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      target = await ctx.client.users
        .fetch(rawUser.replace(/\D/g, ""))
        .catch(() => null);
      newNick = nickParts.join(" ").trim() || null;

      if (!target) {
        return ctx.reply({
          components: [_errorView(`Could not find user \`${rawUser}\`.`)],
          flags: MessageFlags.IsComponentsV2,
        });
      }
    }

    if (newNick && newNick.length > MAX_NICK_LENGTH) {
      return ctx.reply({
        components: [
          _errorView(
            `Nickname must be ${MAX_NICK_LENGTH} characters or fewer (got ${newNick.length}).`,
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

    if (target.id !== ctx.user.id) {
      if (!targetMember.manageable) {
        return ctx.reply({
          components: [
            _errorView(
              `I cannot manage **${target.tag}**'s nickname — their role is too high.`,
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
              `You cannot change **${target.tag}**'s nickname — their role is higher than or equal to yours.`,
            ),
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
      }
    }

    const oldNick = targetMember.nickname ?? null;
    const isReset = newNick === null;

    const auditReason = isReset
      ? `Nickname reset by ${ctx.user.tag} (${ctx.user.id})`
      : `Nickname changed by ${ctx.user.tag} (${ctx.user.id})`;

    try {
      await targetMember.setNickname(newNick, auditReason);
    } catch (err) {
      return ctx.reply({
        components: [
          _errorView(
            `Failed to change nickname for **${target.tag}**: ${err.message}`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    return ctx.reply({
      components: [_successView(target, ctx.user, oldNick, newNick, isReset)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _successView(target, executor, oldNick, newNick, isReset) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.success ?? 0x2ecc71);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      isReset ? "## Nickname Reset" : "## Nickname Changed",
    ),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );

  const lines = [
    `**User:** ${target.tag} \`(${target.id})\``,
    `**Before:** ${oldNick ? `\`${oldNick}\`` : "None"}`,
    `**After:** ${isReset ? "Reset to username" : `\`${newNick}\``}`,
    `**Moderator:** ${executor.tag} \`(${executor.id})\``,
  ];

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );
  return container;
}

function _errorView(description) {
  const container = new ContainerBuilder();
  container.setAccentColor(config.colors.error ?? 0xe74c3c);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Nickname Failed\n\n${description}`),
  );
  return container;
}

export default new NicknameCommand();
