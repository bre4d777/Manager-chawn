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

const CHANNEL_TYPE_MAP = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  stage: ChannelType.GuildStageVoice,
  forum: ChannelType.GuildForum,
  announce: ChannelType.GuildAnnouncement,
  announcement: ChannelType.GuildAnnouncement,
};

const CHANNEL_TYPE_LABELS = {
  [ChannelType.GuildText]: "Text",
  [ChannelType.GuildVoice]: "Voice",
  [ChannelType.GuildCategory]: "Category",
  [ChannelType.GuildStageVoice]: "Stage",
  [ChannelType.GuildForum]: "Forum",
  [ChannelType.GuildAnnouncement]: "Announcement",
};

const TOPIC_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
];

class CreateChannelCommand extends Command {
  constructor() {
    super({
      name: "createchannel",
      description: "Create a text, voice, category, stage, or forum channel",
      usage: "createchannel <name> [--type text|voice|category|stage|forum|announce] [--in #category] [--topic text] [--nsfw] [--reason text]",
      examples: [
        "createchannel general",
        "createchannel general --type text --in #channels",
        "createchannel music --type voice",
        "createchannel Server Info --type category",
        "createchannel rules --topic Read these before chatting",
      ],
      aliases: ["cc", "makechannel", "newchannel"],
      cooldown: 10,
      permissions: [PermissionFlagsBits.ManageChannels],
      userPermissions: [PermissionFlagsBits.ManageChannels],
      enabledSlash: true,
      slashData: {
        name: ["channel", "create"],
        description: "Create a channel or category",
        defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
        options: [
          {
            name: "name",
            description: "Name for the new channel",
            type: 3,
            required: true,
          },
          {
            name: "type",
            description: "Channel type (default: text)",
            type: 3,
            required: false,
            choices: [
              { name: "Text", value: "text" },
              { name: "Voice", value: "voice" },
              { name: "Category", value: "category" },
              { name: "Stage", value: "stage" },
              { name: "Forum", value: "forum" },
              { name: "Announcement", value: "announce" },
            ],
          },
          {
            name: "category",
            description: "Parent category to place the channel in",
            type: 7,
            required: false,
            channel_types: [4],
          },
          {
            name: "topic",
            description: "Channel topic (text/announcement/forum only, max 1024 chars)",
            type: 3,
            required: false,
          },
          {
            name: "nsfw",
            description: "Mark channel as age-restricted",
            type: 5,
            required: false,
          },
          {
            name: "reason",
            description: "Reason for creating the channel",
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

    if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return ctx.reply({
        components: [_errorView("I do not have permission to manage channels.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return ctx.reply({
        components: [_errorView("You do not have permission to manage channels.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let name, channelType, parent, topic, nsfw, reason;

    if (ctx.isSlash) {
      name = ctx.options.getString("name", true).trim();
      const typeKey = ctx.options.getString("type") ?? "text";
      channelType = CHANNEL_TYPE_MAP[typeKey] ?? ChannelType.GuildText;
      parent = ctx.options.getChannel("category") ?? null;
      topic = ctx.options.getString("topic") ?? null;
      nsfw = ctx.options.getBoolean("nsfw") ?? false;
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
      channelType = CHANNEL_TYPE_MAP[parsed.type ?? "text"] ?? ChannelType.GuildText;
      topic = parsed.topic ?? null;
      nsfw = parsed.nsfw ?? false;
      reason = parsed.reason;

      if (parsed.categoryRef) {
        const catId = parsed.categoryRef.replace(/\D/g, "");
        parent = ctx.guild.channels.cache.get(catId) ?? null;
        if (parent && parent.type !== ChannelType.GuildCategory) {
          return ctx.reply({
            components: [_errorView("`--in` must point to a category channel.")],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          });
        }
      }
    }

    if (!name || name.length > 100) {
      return ctx.reply({
        components: [_errorView("Channel name must be between 1 and 100 characters.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const auditReason = _buildAuditReason(ctx.user, "CreateChannel", reason);

    const options = { name, type: channelType, reason: auditReason };

    if (parent && channelType !== ChannelType.GuildCategory) {
      options.parent = parent.id;
    }

    if (topic && TOPIC_TYPES.includes(channelType)) {
      options.topic = topic.slice(0, 1024);
    }

    if (nsfw && channelType !== ChannelType.GuildVoice && channelType !== ChannelType.GuildCategory) {
      options.nsfw = true;
    }

    let newChannel;
    try {
      newChannel = await ctx.guild.channels.create(options);
    } catch (err) {
      return ctx.reply({
        components: [_errorView(`Failed to create channel: ${err.message}`)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    return ctx.reply({
      components: [_successView(newChannel, channelType, ctx.user, reason)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function _parsePrefixArgs(args) {
  if (!args.length) {
    return {
      error:
        "Please provide a channel name.\n\n**Usage:** `createchannel <name> [--type text|voice|category|stage|forum|announce] [--in #category] [--topic text] [--nsfw]`",
    };
  }

  const nameParts = [];
  let type = null;
  let categoryRef = null;
  let topic = null;
  let nsfw = false;
  const reasonParts = [];
  let i = 0;

  while (i < args.length) {
    const tok = args[i];
    if (tok === "--type") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) return { error: "Missing value for `--type`." };
      type = next.toLowerCase();
      if (!CHANNEL_TYPE_MAP[type]) {
        return {
          error: `Unknown type \`${type}\`. Valid: text, voice, category, stage, forum, announce.`,
        };
      }
      i += 2;
    } else if (tok === "--in") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) return { error: "Missing value for `--in`." };
      categoryRef = next;
      i += 2;
    } else if (tok === "--topic") {
      const parts = [];
      i++;
      while (i < args.length && !args[i].startsWith("--")) {
        parts.push(args[i]);
        i++;
      }
      if (!parts.length) return { error: "Missing value for `--topic`." };
      topic = parts.join(" ");
    } else if (tok === "--nsfw") {
      nsfw = true;
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

  const name = nameParts.join("-").trim();
  if (!name) return { error: "Please provide a channel name." };

  return {
    name,
    type,
    categoryRef,
    topic,
    nsfw,
    reason: reasonParts.join(" ").trim() || "No reason provided",
  };
}

function _successView(channel, channelType, executor, reason) {
  const typeLabel = CHANNEL_TYPE_LABELS[channelType] ?? "Unknown";
  const container = new ContainerBuilder();
  container.setAccentColor(colors.success ?? 0x2ecc71);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Channel Created"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Channel:** ${channel}`,
        `**Type:** ${typeLabel}`,
        channel.parent ? `**Category:** ${channel.parent.name}` : null,
        channel.topic ? `**Topic:** ${channel.topic}` : null,
        channel.nsfw ? `**NSFW:** Yes` : null,
        `**Moderator:** ${executor.tag} \`(${executor.id})\``,
        `**Reason:** ${reason}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );
  return container;
}

function _errorView(description) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.error ?? 0xe74c3c);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Create Channel Failed\n\n${description}`),
  );
  return container;
}

function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}

export default new CreateChannelCommand();