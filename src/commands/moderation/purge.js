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
import { sleep } from "#utils";

const { colors } = config;

const MAX_SCAN = 1_000;
const BATCH_SIZE = 100;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;
const BATCH_DELAY = 1_100;

class PurgeCommand extends Command {
  constructor() {
    super({
      name: "purge",
      description: "Bulk delete messages with filters",
      usage:
        "purge <amount> [--user @u] [--bots] [--humans] [--contains text] [--startswith text] [--embeds] [--attachments] [--mentions] [--links] [--regex pattern] [--reason text]",
      examples: [
        "purge 100",
        "purge 50 --user @user",
        "purge 200 --bots",
        "purge 100 --contains discord.gg",
        "purge 500 --regex https?://",
      ],
      aliases: ["clear", "prune", "delete"],
      cooldown: 8,
      permissions: [PermissionFlagsBits.ManageMessages],
      userPermissions: [PermissionFlagsBits.ManageMessages],
      enabledSlash: true,
      slashData: {
        name: ["mod", "purge"],
        description: "Bulk delete messages with filters",
        defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
        options: [
          {
            name: "amount",
            description: `Messages to scan (1–${MAX_SCAN})`,
            type: 4,
            required: true,
            min_value: 1,
            max_value: MAX_SCAN,
          },
          {
            name: "user",
            description: "Only messages from this user",
            type: 6,
            required: false,
          },
          {
            name: "bots",
            description: "Only bot messages",
            type: 5,
            required: false,
          },
          {
            name: "humans",
            description: "Only human messages",
            type: 5,
            required: false,
          },
          {
            name: "contains",
            description: "Messages containing this text",
            type: 3,
            required: false,
          },
          {
            name: "startswith",
            description: "Messages starting with this text",
            type: 3,
            required: false,
          },
          {
            name: "embeds",
            description: "Only messages with embeds",
            type: 5,
            required: false,
          },
          {
            name: "attachments",
            description: "Only messages with attachments",
            type: 5,
            required: false,
          },
          {
            name: "mentions",
            description: "Only messages mentioning users/roles",
            type: 5,
            required: false,
          },
          {
            name: "links",
            description: "Only messages containing links",
            type: 5,
            required: false,
          },
          {
            name: "regex",
            description: "Messages matching this regex pattern",
            type: 3,
            required: false,
          },
          {
            name: "reason",
            description: "Reason for the purge",
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

    if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return ctx.reply({
        components: [
          _errorView("I do not have permission to manage messages."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (
      !botMember
        .permissionsIn(ctx.channel)
        .has(PermissionFlagsBits.ManageMessages)
    ) {
      return ctx.reply({
        components: [
          _errorView(
            "I do not have permission to manage messages in this channel.",
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return ctx.reply({
        components: [
          _errorView("You do not have permission to manage messages."),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let amount, filters, reason;
    const invokeId = ctx.isPrefix && ctx.message ? ctx.message.id : null;

    if (ctx.isSlash) {
      amount = ctx.options.getInteger("amount", true);
      reason = ctx.options.getString("reason") ?? "No reason provided";
      filters = {
        userId: ctx.options.getUser("user")?.id ?? null,
        bots: ctx.options.getBoolean("bots") ?? false,
        humans: ctx.options.getBoolean("humans") ?? false,
        contains: ctx.options.getString("contains") ?? null,
        startswith: ctx.options.getString("startswith") ?? null,
        embeds: ctx.options.getBoolean("embeds") ?? false,
        attachments: ctx.options.getBoolean("attachments") ?? false,
        mentions: ctx.options.getBoolean("mentions") ?? false,
        links: ctx.options.getBoolean("links") ?? false,
        regex: ctx.options.getString("regex") ?? null,
      };
    } else {
      const parsed = _parsePrefixArgs(ctx.args);

      if (parsed.error) {
        return ctx.reply({
          components: [_errorView(parsed.error)],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      if (parsed.rawUser) {
        const resolved = await ctx.client.users
          .fetch(parsed.rawUser.replace(/\D/g, ""))
          .catch(() => null);

        if (!resolved) {
          return ctx.reply({
            components: [
              _errorView(`Could not find user \`${parsed.rawUser}\`.`),
            ],
            flags: MessageFlags.IsComponentsV2,
          });
        }

        parsed.filters.userId = resolved.id;
      }

      amount = parsed.amount;
      reason = parsed.reason;
      filters = parsed.filters;
    }

    if (filters.bots && filters.humans) {
      return ctx.reply({
        components: [_errorView("`--bots` and `--humans` cannot be combined.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (filters.regex) {
      try {
        new RegExp(filters.regex, "i");
      } catch {
        return ctx.reply({
          components: [
            _errorView(`Invalid regex pattern: \`${filters.regex}\``),
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
      }
    }

    await ctx.deferReply({ ephemeral: true });


    const result = await _runPurge({
      channel: ctx.channel,
      amount,
      filters,
      invokeId,
     });

    if (result.error) {
      return ctx.editReply({
        components: [_errorView(result.error)],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    return ctx.editReply({
      components: [
        _successView(result, filters, ctx.user, reason, ctx.channel),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

async function _runPurge({ channel, amount, filters, invokeId}) {
  const cutoff = Date.now() - MAX_AGE_MS;
  const eligible = [];
  let tooOld = 0;
  let filtered = 0;
  let lastId = null;
  let remaining = amount;

  outer: while (remaining > 0) {
    const fetchOpts = { limit: Math.min(remaining, BATCH_SIZE) };
    if (lastId) fetchOpts.before = lastId;

    let batch;
    try {
      batch = await channel.messages.fetch(fetchOpts);
    } catch {
      return { error: "Failed to fetch messages from this channel." };
    }

    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      lastId = msg.id;

      if (msg.createdTimestamp < cutoff) {
        tooOld++;
        break outer;
      }

      if (invokeId && msg.id === invokeId) continue;

      if (!_matchesFilters(msg, filters)) {
        filtered++;
        continue;
      }

      eligible.push(msg);
    }

    remaining -= batch.size;
  }

  if (eligible.length === 0) {
    return {
      error:
        tooOld > 0
          ? `No eligible messages found. ${tooOld} message(s) were beyond the 14-day bulk-delete limit.`
          : "No messages matched the provided filters.",
    };
  }

  const batches = [];
  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    batches.push(eligible.slice(i, i + BATCH_SIZE));
  }

  let deleted = 0;
  let skipped = 0;

  for (let i = 0; i < batches.length; i++) {
    if (i > 0) await sleep(BATCH_DELAY);

    try {
      const res = await channel.bulkDelete(batches[i], true);
      deleted += res.size;
      skipped += batches[i].length - res.size;
    } catch {
      skipped += batches[i].length;
    }
  }

  return { deleted, skipped, tooOld, filtered, batches: batches.length };
}

function _matchesFilters(msg, f) {
  if (f.userId && msg.author.id !== f.userId) return false;
  if (f.bots && !msg.author.bot) return false;
  if (f.humans && msg.author.bot) return false;
  if (f.embeds && msg.embeds.length === 0) return false;
  if (f.attachments && msg.attachments.size === 0) return false;
  if (
    f.mentions &&
    msg.mentions.users.size === 0 &&
    msg.mentions.roles.size === 0
  )
    return false;
  if (f.links && !/https?:\/\//i.test(msg.content)) return false;
  if (
    f.contains &&
    !msg.content.toLowerCase().includes(f.contains.toLowerCase())
  )
    return false;
  if (
    f.startswith &&
    !msg.content.toLowerCase().startsWith(f.startswith.toLowerCase())
  )
    return false;
  if (f.regex) {
    try {
      if (!new RegExp(f.regex, "i").test(msg.content)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function _parsePrefixArgs(args) {
  if (!args.length) {
    return {
      error:
        "Please provide an amount.\n\n**Usage:** `purge <amount> [--flags]`",
    };
  }

  const amount = parseInt(args[0], 10);
  if (isNaN(amount) || amount < 1)
    return { error: `\`${args[0]}\` is not a valid number.` };
  if (amount > MAX_SCAN)
    return { error: `Maximum scan amount is **${MAX_SCAN}**.` };

  const filters = {
    userId: null,
    bots: false,
    humans: false,
    contains: null,
    startswith: null,
    embeds: false,
    attachments: false,
    mentions: false,
    links: false,
    regex: null,
  };

  let rawUser = null;
  const reasonParts = [];
  let i = 1;

  const second = args[1];
  if (second && !second.startsWith("--")) {
    if (/^<@!?\d+>$/.test(second) || /^\d{17,20}$/.test(second)) {
      rawUser = second;
      i = 2;
    }
  }

  const readValue = (flag) => {
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      return { error: `Missing value for \`${flag}\`.` };
    }
    i += 2;
    return { value: next };
  };

  while (i < args.length) {
    const tok = args[i];
    if (tok === "--bots") {
      filters.bots = true;
      i++;
    } else if (tok === "--humans") {
      filters.humans = true;
      i++;
    } else if (tok === "--embeds") {
      filters.embeds = true;
      i++;
    } else if (tok === "--attachments") {
      filters.attachments = true;
      i++;
    } else if (tok === "--mentions") {
      filters.mentions = true;
      i++;
    } else if (tok === "--links") {
      filters.links = true;
      i++;
    } else if (tok === "--contains") {
      const v = readValue("--contains");
      if (v.error) return { error: v.error };
      filters.contains = v.value;
    } else if (tok === "--startswith") {
      const v = readValue("--startswith");
      if (v.error) return { error: v.error };
      filters.startswith = v.value;
    } else if (tok === "--regex") {
      const v = readValue("--regex");
      if (v.error) return { error: v.error };
      filters.regex = v.value;
    } else if (tok === "--user") {
      const v = readValue("--user");
      if (v.error) return { error: v.error };
      rawUser = v.value;
    } else if (tok === "--reason") {
      reasonParts.push(...args.slice(i + 1));
      i = args.length;
    } else {
      i++;
    }
  }

  return {
    amount,
    rawUser,
    filters,
    reason: reasonParts.join(" ").trim() || "No reason provided",
  };
}


function _successView(result, filters, executor, reason, channel) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.success ?? 0x2ecc71);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Messages Purged"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );

  const activeFilters = Object.entries(filters)
    .filter(([, v]) => v && v !== false)
    .map(([k, v]) => (typeof v === "string" ? `\`${k}: ${v}\`` : `\`${k}\``))
    .join(", ");

  const lines = [
    `**Channel:** ${channel}`,
    `**Deleted:** ${result.deleted} message${result.deleted === 1 ? "" : "s"}`,
    result.skipped > 0 ? `**Skipped:** ${result.skipped}` : null,
    result.tooOld > 0 ? `**Beyond 14 days:** ${result.tooOld}` : null,
    result.filtered > 0 ? `**Filtered out:** ${result.filtered}` : null,
    result.batches > 1 ? `**Batches sent:** ${result.batches}` : null,
    activeFilters ? `**Filters:** ${activeFilters}` : null,
    `**Moderator:** ${executor.tag}`,
    `**Reason:** ${reason}`,
  ].filter(Boolean);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );
  return container;
}

function _errorView(description) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.error ?? 0xe74c3c);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Purge Failed\n\n${description}`),
  );
  return container;
}

export default new PurgeCommand();