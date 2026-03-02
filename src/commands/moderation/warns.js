import { Command } from '#command';
import {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from '#config';
import { disableComponents, logger } from '#utils';
import { db } from '#dbManager';


const { colors } = config;

const PAGE_SIZE = 8;

class WarningsCommand extends Command {
  constructor() {
    super({
      name: 'warnings',
      description: 'View warnings for a member',
      usage: 'warnings <user>',
      examples: ['warnings @user'],
      aliases: ['warns', 'infractions'],
      cooldown: 5,
      permissions:     [PermissionFlagsBits.ModerateMembers],
      userPermissions: [PermissionFlagsBits.ModerateMembers],
      enabledSlash: true,
      slashData: {
        name: ['mod', 'warnings'],
        description: 'View warnings for a member',
        defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
        options: [
          { name: 'user', description: 'Member to view warnings for', type: 6, required: true },
        ],
      },
    });
  }

  async execute({ ctx }) {
    if (!ctx.inGuild()) {
      return ctx.reply({
        components: [_errorView('This command can only be used in a server.')],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return ctx.reply({
        components: [_errorView('You do not have permission to view warnings.')],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let target;

    if (ctx.isSlash) {
      target = ctx.options.getUser('user', true);
    } else {
      const [rawUser] = ctx.args;

      if (!rawUser) {
        return ctx.reply({
          components: [_errorView('Please provide a member.\n\n**Usage:** `warnings <user>`')],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      target = await ctx.client.users.fetch(rawUser.replace(/\D/g, '')).catch(() => null);
      if (!target) {
        return ctx.reply({
          components: [_errorView(`Could not find user \`${rawUser}\`.`)],
          flags: MessageFlags.IsComponentsV2,
        });
      }
    }

    const allWarns = await db.warns.getWarns(ctx.guild.id, target.id);

    await ctx.reply({
      components: [_buildView(target, allWarns, 0)],
      flags: MessageFlags.IsComponentsV2,
    });

    const message = await ctx.fetchReply();
    if (allWarns.length === 0) return;

    _startCollector(ctx, message, target, allWarns);
  }
}

function _buildView(target, allWarns, page) {
  const container  = new ContainerBuilder();
  const totalPages = Math.max(1, Math.ceil(allWarns.length / PAGE_SIZE));
  const safePage   = Math.max(0, Math.min(page, totalPages - 1));
  const pageWarns  = allWarns.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  container.setAccentColor(allWarns.length > 0 ? (config.colors.warning ?? 0xf39c12) : (config.colors.success ?? 0x2ecc71));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Warnings — ${target.tag}`),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  if (allWarns.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${target.tag}** has no warnings in this server.`),
    );
    return container;
  }

  const lines = pageWarns.map((w) => {
    const ts = Math.floor(new Date(w.createdAt).getTime() / 1_000);
    return `**#${w.id}** — ${w.reason}\n-# <@${w.moderatorId}> • <t:${ts}:R>`;
  });

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      lines.join('\n\n') +
      `\n\n-# ${allWarns.length} total warn${allWarns.length === 1 ? '' : 's'} • Page ${safePage + 1}/${totalPages}`,
    ),
  );

  const btns = [];

  if (totalPages > 1) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`warnings|prev|${safePage}`)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀️')
        .setDisabled(safePage === 0),
      new ButtonBuilder()
        .setCustomId(`warnings|next|${safePage}`)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('▶️')
        .setDisabled(safePage === totalPages - 1),
    );
  }

  btns.push(
    new ButtonBuilder()
      .setCustomId('warnings|clear')
      .setLabel('Clear All Warnings')
      .setStyle(ButtonStyle.Danger),
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(btns));
  return container;
}

function _startCollector(ctx, message, target, allWarns) {
  let currentWarns = allWarns;

  const collector = message.createMessageComponentCollector({
    time: 300_000,
    filter: (i) => {
      if (i.user.id !== ctx.author.id) {
        i.reply({
          content: 'This is not your command.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return false;
      }
      return true;
    },
  });

  collector.on('collect', async (i) => {
    try {
      const [, action, pageStr] = i.customId.split('|');

      if (action === 'clear') {
        await i.deferUpdate();
        await db.warns.clearWarns(ctx.guild.id, target.id);
        currentWarns = [];

        const container = new ContainerBuilder();
        container.setAccentColor(config.colors.success ?? 0x2ecc71);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## Warnings Cleared\n\nAll warnings for **${target.tag}** have been removed.`),
        );
        await message.edit({ components: [container] });
      
        return;
      }

      const currentPage = parseInt(pageStr, 10);
      const nextPage    = action === 'next' ? currentPage + 1 : currentPage - 1;
      await i.deferUpdate();
      await message.edit({ components: [_buildView(target, currentWarns, nextPage)] });
    } catch (err) {
      logger.error('Warnings', 'Interaction error', err);
    }
  });

  collector.on('end', async () => {
    try {
      await disableComponents(message);
    } catch {}
  });
}

function _errorView(description) {
  const container = new ContainerBuilder();
  container.setAccentColor(config.colors.error ?? 0xe74c3c);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Warnings Failed\n\n${description}`),
  );
  return container;
}

export default new WarningsCommand();