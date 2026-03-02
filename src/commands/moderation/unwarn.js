import { Command } from '#command';
import {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from '#config';
import { db } from '#dbManager';


const { colors } = config;

class UnwarnCommand extends Command {
  constructor() {
    super({
      name: 'unwarn',
      description: 'Remove a specific warning by ID',
      usage: 'unwarn <user> <warnId> [reason]',
      examples: ['unwarn @user 12', 'unwarn @user 12 false report'],
      aliases: ['removewarn', 'delwarn'],
      cooldown: 5,
      permissions:     [PermissionFlagsBits.ModerateMembers],
      userPermissions: [PermissionFlagsBits.ModerateMembers],
      enabledSlash: true,
      slashData: {
        name: ['mod', 'unwarn'],
        description: 'Remove a specific warning by ID',
        defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
        options: [
          { name: 'user',    description: 'Member whose warn to remove',      type: 6, required: true  },
          { name: 'warn_id', description: 'The warn ID to remove',            type: 4, required: true, min_value: 1 },
          { name: 'reason',  description: 'Reason for removing the warning',  type: 3, required: false },
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
        components: [_errorView('You do not have permission to remove warnings.')],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let target, warnId, reason;

    if (ctx.isSlash) {
      target = ctx.options.getUser('user', true);
      warnId = ctx.options.getInteger('warn_id', true);
      reason = ctx.options.getString('reason') ?? 'No reason provided';
    } else {
      const [rawUser, rawId, ...reasonParts] = ctx.args;

      if (!rawUser) {
        return ctx.reply({
          components: [_errorView('Please provide a member.\n\n**Usage:** `unwarn <user> <warnId> [reason]`')],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      if (!rawId) {
        return ctx.reply({
          components: [_errorView('Please provide the warn ID to remove.')],
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

      warnId = parseInt(rawId, 10);
      if (isNaN(warnId) || warnId < 1) {
        return ctx.reply({
          components: [_errorView(`\`${rawId}\` is not a valid warn ID.`)],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      reason = reasonParts.join(' ').trim() || 'No reason provided';
    }

    const removed = await db.warns.removeWarn(warnId, ctx.guild.id, target.id);

    if (!removed) {
      return ctx.reply({
        components: [_errorView(`Warn #${warnId} not found for **${target.tag}** in this server.`)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const remaining = await db.warns.getWarnCount(ctx.guild.id, target.id);

    return ctx.reply({
      components: [_successView(target, ctx.user, warnId, reason, remaining)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _successView(target, executor, warnId, reason, remaining) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.success ?? 0x2ecc71);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Warning Removed'),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `**User:** ${target.tag} \`(${target.id})\``,
      `**Removed Warn #${warnId}** — Remaining: **${remaining}** warn${remaining === 1 ? '' : 's'}`,
      `**Moderator:** ${executor.tag} \`(${executor.id})\``,
      `**Reason:** ${reason}`,
    ].join('\n')),
  );
  return container;
}

function _errorView(description) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.error ?? 0xe74c3c);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Unwarn Failed\n\n${description}`),
  );
  return container;
}

export default new UnwarnCommand();