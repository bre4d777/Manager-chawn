import { Command } from "#command";
import {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import { config } from "#config";

const { colors } = config;

const MAX_AUDIT_REASON_LENGTH = 512;

const CLONEABLE_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildStageVoice,
  ChannelType.GuildCategory,
];

const CHANNEL_TYPE_LABELS = {
  [ChannelType.GuildText]: "Text",
  [ChannelType.GuildVoice]: "Voice",
  [ChannelType.GuildAnnouncement]: "Announcement",
  [ChannelType.GuildForum]: "Forum",
  [ChannelType.GuildStageVoice]: "Stage",
  [ChannelType.GuildCategory]: "Category",
};

class CloneCommand extends Command {
  constructor() {
    super({
      name: "clone",
      description:
        "Clone a channel or an entire category with all its children",
      usage: "clone [#channel|#category] [--name new-name] [--reason text]",
      examples: [
        "clone",
        "clone #general",
        "clone #general --name general-2",
        "clone #server-info --name archive-info",
        "clone #Staff Category --reason restructuring",
      ],
      aliases: ["copychannel", "clonechannel"],
      cooldown: 15,
      permissions: [PermissionFlagsBits.ManageChannels],
      userPermissions: [PermissionFlagsBits.ManageChannels],
      enabledSlash: true,
      slashData: {
        name: ["channel", "clone"],
        description:
          "Clone a channel or an entire category with all its children",
        defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
        options: [
          {
            name: "channel",
            description: "Channel or category to clone (defaults to current)",
            type: 7,
            required: false,
          },
          {
            name: "name",
            description:
              "Override the name for the clone (default: copy-of-<name>)",
            type: 3,
            required: false,
          },
          {
            name: "reason",
            description: "Reason for cloning",
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

    if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return ctx.reply({
        components: [
          _errorView("I do not have permission to manage channels."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return ctx.reply({
        components: [
          _errorView("You do not have permission to manage channels."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let target, overrideName, reason;

    if (ctx.isSlash) {
      target = ctx.options.getChannel("channel") ?? ctx.channel;
      overrideName = ctx.options.getString("name") ?? null;
      reason = ctx.options.getString("reason") ?? "No reason provided";
    } else {
      const parsed = _parsePrefixArgs(ctx.args);
      if (parsed.error) {
        return ctx.reply({
          components: [_errorView(parsed.error)],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      overrideName = parsed.name ?? null;
      reason = parsed.reason;

      if (parsed.channelRef) {
        const id = parsed.channelRef.replace(/\D/g, "");
        target = ctx.guild.channels.cache.get(id);
        if (!target) {
          return ctx.reply({
            components: [
              _errorView(`Could not find channel \`${parsed.channelRef}\`.`),
            ],
            flags: MessageFlags.IsComponentsV2,
          });
        }
      } else {
        target = ctx.channel;
      }
    }

    if (!CLONEABLE_TYPES.includes(target.type)) {
      return ctx.reply({
        components: [_errorView("That channel type cannot be cloned.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (
      !botMember.permissionsIn(target).has(PermissionFlagsBits.ManageChannels)
    ) {
      return ctx.reply({
        components: [
          _errorView(`I do not have permission to manage ${target}.`),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (overrideName && overrideName.length > 100) {
      return ctx.reply({
        components: [
          _errorView("Channel name must be 100 characters or fewer."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const auditReason = _buildAuditReason(ctx.user, "Clone", reason);

    if (target.type === ChannelType.GuildCategory) {
      const children = ctx.guild.channels.cache
        .filter((c) => c.parentId === target.id)
        .sort((a, b) => a.rawPosition - b.rawPosition);

      let clonedCategory;
      try {
        clonedCategory = await target.clone({
          name: overrideName ?? `${target.name}`,
          reason: auditReason,
        });
      } catch (err) {
        return ctx.reply({
          components: [_errorView(`Failed to clone category: ${err.message}`)],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      let childSuccess = 0;
      let childFailed = 0;
      const failedNames = [];

      for (const child of children.values()) {
        try {
          const clonedChild = await child.clone({
            name: child.name,
            parent: clonedCategory.id,
            reason: auditReason,
          });
          await clonedChild
            .setPosition(child.rawPosition, { reason: auditReason })
            .catch(() => {});
          childSuccess++;
        } catch {
          childFailed++;
          failedNames.push(child.name);
        }
      }

      return ctx.reply({
        components: [
          _successViewCategory(
            target,
            clonedCategory,
            childSuccess,
            childFailed,
            failedNames,
            ctx.user,
            reason,
          ),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    let cloned;
    try {
      cloned = await target.clone({
        name: overrideName ?? `copy-of-${target.name}`,
        reason: auditReason,
      });

      if (target.parent) {
        await cloned.setParent(target.parent.id, {
          lockPermissions: false,
          reason: auditReason,
        });
      }

      await cloned
        .setPosition(target.rawPosition + 1, { reason: auditReason })
        .catch(() => {});
    } catch (err) {
      return ctx.editReply({
        components: [_errorView(`Failed to clone channel: ${err.message}`)],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    return ctx.reply({
      components: [_successViewChannel(target, cloned, ctx.user, reason)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _parsePrefixArgs(args) {
  let channelRef = null;
  let name = null;
  const reasonParts = [];
  let i = 0;

  const first = args[0];
  if (first && !first.startsWith("--")) {
    if (/^<#\d+>$/.test(first)) {
      channelRef = first;
      i = 1;
    }
  }

  while (i < args.length) {
    const tok = args[i];
    if (tok === "--name") {
      const next = args[i + 1];
      if (!next || next.startsWith("--"))
        return { error: "Missing value for `--name`." };
      name = next;
      i += 2;
    } else if (tok === "--reason") {
      reasonParts.push(...args.slice(i + 1));
      i = args.length;
    } else {
      i++;
    }
  }

  return {
    channelRef,
    name,
    reason: reasonParts.join(" ").trim() || "No reason provided",
  };
}

function _successViewChannel(original, cloned, executor, reason) {
  const typeLabel = CHANNEL_TYPE_LABELS[cloned.type] ?? "Channel";
  const container = new ContainerBuilder();
  container.setAccentColor(colors.success ?? 0x2ecc71);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Channel Cloned"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Original:** ${original} \`(${original.id})\``,
        `**Clone:** ${cloned} \`(${cloned.id})\``,
        `**Type:** ${typeLabel}`,
        cloned.parent ? `**Category:** ${cloned.parent.name}` : null,
        `**Moderator:** ${executor.tag} \`(${executor.id})\``,
        `**Reason:** ${reason}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );
  return container;
}

function _successViewCategory(
  original,
  cloned,
  childSuccess,
  childFailed,
  failedNames,
  executor,
  reason,
) {
  const container = new ContainerBuilder();
  container.setAccentColor(
    childFailed > 0
      ? (colors.warning ?? 0xf39c12)
      : (colors.success ?? 0x2ecc71),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Category Cloned"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );
  const lines = [
    `**Original:** #${original.name} \`(${original.id})\``,
    `**Clone:** #${cloned.name} \`(${cloned.id})\``,
    `**Channels Cloned:** ${childSuccess}`,
  ];
  if (childFailed > 0) {
    lines.push(
      `**Failed:** ${childFailed} (${failedNames.map((n) => `\`${n}\``).join(", ")})`,
    );
  }
  lines.push(
    `**Moderator:** ${executor.tag} \`(${executor.id})\``,
    `**Reason:** ${reason}`,
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );
  return container;
}

function _errorView(description) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.error ?? 0xe74c3c);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Clone Failed\n\n${description}`),
  );
  return container;
}

function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}

export default new CloneCommand();
