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

class ResetNickCommand extends Command {
  constructor() {
    super({
      name: "resetnick",
      description: "Reset a member's nickname to their username",
      usage: "resetnick <user>",
      examples: ["resetnick @user"],
      aliases: ["clearnick", "removenick"],
      cooldown: 5,
      permissions: [PermissionFlagsBits.ManageNicknames],
      userPermissions: [PermissionFlagsBits.ManageNicknames],
      enabledSlash: true,
      slashData: {
        name: ["mod", "resetnick"],
        description: "Reset a member's nickname to their username",
        defaultMemberPermissions: PermissionFlagsBits.ManageNicknames,
        options: [
          {
            name: "user",
            description: "Member to reset nickname for",
            type: 6,
            required: true,
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

    let target;

    if (ctx.isSlash) {
      target = ctx.options.getUser("user", true);
    } else {
      const [rawUser] = ctx.args;

      if (!rawUser) {
        return ctx.reply({
          components: [
            _errorView(
              "Please provide a member.\n\n**Usage:** `resetnick <user>`",
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

    if (!targetMember.nickname) {
      return ctx.reply({
        components: [
          _errorView(`**${target.tag}** does not have a nickname to reset.`),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

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

    if (target.id !== ctx.user.id) {
      const execHighest = ctx.member.roles?.highest?.position ?? 0;
      const targetHighest = targetMember.roles?.highest?.position ?? 0;

      if (execHighest <= targetHighest && ctx.guild.ownerId !== ctx.user.id) {
        return ctx.reply({
          components: [
            _errorView(
              `You cannot reset **${target.tag}**'s nickname — their role is higher than or equal to yours.`,
            ),
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
      }
    }

    const oldNick = targetMember.nickname;

    try {
      await targetMember.setNickname(
        null,
        `Nickname reset by ${ctx.user.tag} (${ctx.user.id})`,
      );
    } catch (err) {
      return ctx.reply({
        components: [
          _errorView(
            `Failed to reset nickname for **${target.tag}**: ${err.message}`,
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    return ctx.reply({
      components: [_successView(target, ctx.user, oldNick)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _successView(target, executor, oldNick) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.success ?? 0x2ecc71);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Nickname Reset"),
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
        `**Old Nickname:** \`${oldNick}\``,
        `**Moderator:** ${executor.tag} \`(${executor.id})\``,
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
      `## Reset Nick Failed\n\n${description}`,
    ),
  );
  return container;
}

export default new ResetNickCommand();
