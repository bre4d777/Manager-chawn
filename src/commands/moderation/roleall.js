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

const MAX_AUDIT_REASON_LENGTH = 512;
const ROLE_BATCH_SIZE = 5;
const ROLE_BATCH_DELAY = 1_100;
const PROGRESS_UPDATE_INTERVAL = 5_000;

class RoleAllCommand extends Command {
  constructor() {
    super({
      name: "roleall",
      description: "Add or remove a role from every member in the server",
      usage:
        "roleall <add|remove> <@role> [--exclude @role] [--include @role] [--reason text]",
      examples: [
        "roleall add @Member",
        "roleall remove @Muted",
        "roleall add @Verified --include @Pending",
        "roleall remove @Event --exclude @Staff",
      ],
      aliases: ["massrole", "bulkrole"],
      cooldown: 60,
      permissions: [PermissionFlagsBits.ManageRoles],
      userPermissions: [PermissionFlagsBits.ManageRoles],
      enabledSlash: true,
      slashData: {
        name: ["role", "all"],
        description: "Add or remove a role from every member in the server",
        defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
        options: [
          {
            name: "action",
            description: "Whether to add or remove the role",
            type: 3,
            required: true,
            choices: [
              { name: "Add", value: "add" },
              { name: "Remove", value: "remove" },
            ],
          },
          {
            name: "role",
            description: "The role to assign or remove",
            type: 8,
            required: true,
          },
          {
            name: "exclude_role",
            description: "Skip members who already have this role",
            type: 8,
            required: false,
          },
          {
            name: "include_role",
            description: "Only target members who have this role",
            type: 8,
            required: false,
          },
          {
            name: "reason",
            description: "Reason for the mass role change",
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

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return ctx.reply({
        components: [_errorView("I do not have permission to manage roles.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return ctx.reply({
        components: [_errorView("You do not have permission to manage roles.")],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    let action, role, excludeRole, includeRole, reason;

    if (ctx.isSlash) {
      action = ctx.options.getString("action", true);
      role = ctx.options.getRole("role", true);
      excludeRole = ctx.options.getRole("exclude_role") ?? null;
      includeRole = ctx.options.getRole("include_role") ?? null;
      reason = ctx.options.getString("reason") ?? "No reason provided";
    } else {
      const parsed = _parseMassRoleArgs(ctx.args);
      if (parsed.error) {
        return ctx.reply({
          components: [_errorView(parsed.error)],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      action = parsed.action;
      reason = parsed.reason;

      role = ctx.guild.roles.cache.get(parsed.roleId);
      if (!role) {
        return ctx.reply({
          components: [_errorView(`Could not find role \`${ctx.args[1]}\`.`)],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      excludeRole = parsed.excludeRoleId
        ? (ctx.guild.roles.cache.get(parsed.excludeRoleId) ?? null)
        : null;

      includeRole = parsed.includeRoleId
        ? (ctx.guild.roles.cache.get(parsed.includeRoleId) ?? null)
        : null;
    }

    const roleError = _validateRole(role, botMember, ctx);
    if (roleError) {
      return ctx.reply({
        components: [_errorView(roleError)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    await ctx.deferReply({ flags: MessageFlags.IsComponentsV2 });

    const result = await _runMassRole(
      ctx,
      role,
      action,
      () => true,
      excludeRole?.id ?? null,
      includeRole?.id ?? null,
      reason,
    );

    if (result.error) {
      return ctx.editReply({
        components: [_errorView(result.error)],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    return ctx.editReply({
      components: [
        _finalView(role, action, result, ctx.user, reason, "All members"),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

async function _runMassRole(
  ctx,
  role,
  action,
  baseFilter,
  excludeRoleId,
  includeRoleId,
  reason,
) {
  const startTime = Date.now();

  let allMembers;
  try {
    allMembers = await ctx.guild.members.fetch();
  } catch (err) {
    return { error: `Failed to fetch members: ${err.message}` };
  }

  const pool = [...allMembers.values()].filter((m) => {
    if (m.user.id === ctx.client.user.id) return false;
    if (!baseFilter(m)) return false;
    if (excludeRoleId && m.roles.cache.has(excludeRoleId)) return false;
    if (includeRoleId && !m.roles.cache.has(includeRoleId)) return false;
    return true;
  });

  const toProcess = pool.filter((m) => {
    if (action === "add") return !m.roles.cache.has(role.id);
    return m.roles.cache.has(role.id);
  });

  const skipped = pool.length - toProcess.length;

  if (toProcess.length === 0) {
    return { toProcess: 0, success: 0, failed: 0, skipped, noOp: true };
  }

  const etaMs =
    Math.ceil(toProcess.length / ROLE_BATCH_SIZE) * ROLE_BATCH_DELAY;
  const etaUnix = Math.floor((Date.now() + etaMs) / 1000);

  await ctx
    .editReply({
      components: [
        _progressView(role, action, 0, toProcess.length, etaUnix, 0, 0),
      ],
      flags: MessageFlags.IsComponentsV2,
    })
    .catch(() => {});

  let success = 0;
  let failed = 0;
  let lastUpdate = Date.now();
  const auditReason = _buildAuditReason(
    ctx.user,
    action === "add" ? "RoleAll-Add" : "RoleAll-Remove",
    reason,
  );

  for (let i = 0; i < toProcess.length; i += ROLE_BATCH_SIZE) {
    if (i > 0) await sleep(ROLE_BATCH_DELAY);

    const batch = toProcess.slice(i, i + ROLE_BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (member) => {
        try {
          if (action === "add") {
            await member.roles.add(role, auditReason);
          } else {
            await member.roles.remove(role, auditReason);
          }
          success++;
        } catch {
          failed++;
        }
      }),
    );

    const processed = Math.min(i + ROLE_BATCH_SIZE, toProcess.length);
    const now = Date.now();

    if (now - lastUpdate >= PROGRESS_UPDATE_INTERVAL) {
      const elapsed = now - startTime;
      const rate = processed / elapsed;
      const remaining = toProcess.length - processed;
      const dynamicEtaMs = rate > 0 ? remaining / rate : 0;
      const dynamicEtaUnix = Math.floor((now + dynamicEtaMs) / 1000);

      await ctx
        .editReply({
          components: [
            _progressView(
              role,
              action,
              processed,
              toProcess.length,
              dynamicEtaUnix,
              success,
              failed,
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        })
        .catch(() => {});

      lastUpdate = now;
    }
  }

  return { toProcess: toProcess.length, success, failed, skipped };
}

function _progressView(
  role,
  action,
  processed,
  total,
  etaUnix,
  success,
  failed,
) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const barLen = 12;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled);

  const container = new ContainerBuilder();
  container.setAccentColor(colors.warning ?? 0xf39c12);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Mass Role — In Progress"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Role:** ${role}`,
        `**Action:** ${action === "add" ? "Adding" : "Removing"}`,
        `\`${bar}\` **${processed}** / **${total}** (${pct}%)`,
        processed < total ? `**ETA:** <t:${etaUnix}:R>` : "**Finishing up...**",
        `✅ ${success} succeeded  ·  ❌ ${failed} failed`,
      ].join("\n"),
    ),
  );
  return container;
}

function _finalView(role, action, result, executor, reason, targetLabel) {
  const container = new ContainerBuilder();
  container.setAccentColor(
    result.failed > 0
      ? (colors.warning ?? 0xf39c12)
      : (colors.success ?? 0x2ecc71),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Mass Role — Complete"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Role:** ${role}`,
        `**Action:** ${action === "add" ? "Added to" : "Removed from"} ${targetLabel}`,
        result.noOp
          ? `**Result:** No eligible members to ${action}.`
          : `**Processed:** ${result.toProcess} members`,
        !result.noOp && result.success > 0
          ? `**Success:** ${result.success}`
          : null,
        !result.noOp && result.failed > 0
          ? `**Failed:** ${result.failed}`
          : null,
        result.skipped > 0
          ? `**Already ${action === "add" ? "had" : "lacked"} role:** ${result.skipped}`
          : null,
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
    new TextDisplayBuilder().setContent(
      `## Mass Role Failed\n\n${description}`,
    ),
  );
  return container;
}

function _validateRole(role, botMember, ctx) {
  if (role.managed)
    return "Managed roles (bot/integration roles) cannot be mass-assigned.";
  if (role.id === ctx.guild.roles.everyone.id)
    return "The @everyone role cannot be assigned.";
  if (role.position >= botMember.roles.highest.position) {
    return `I cannot assign ${role} — it is higher than or equal to my highest role.`;
  }
  const execHighest = ctx.member.roles?.highest?.position ?? 0;
  if (role.position >= execHighest && ctx.guild.ownerId !== ctx.user.id) {
    return `You cannot assign ${role} — it is higher than or equal to your highest role.`;
  }
  return null;
}

function _parseMassRoleArgs(args) {
  if (args.length < 2) {
    return {
      error:
        "Please provide an action and role.\n\n**Usage:** `roleall <add|remove> <@role> [--exclude @role] [--include @role] [--reason text]`",
    };
  }

  const action = args[0].toLowerCase();
  if (action !== "add" && action !== "remove") {
    return { error: "Action must be `add` or `remove`." };
  }

  const roleId = args[1].replace(/[<@&>]/g, "");
  let excludeRoleId = null;
  let includeRoleId = null;
  const reasonParts = [];
  let i = 2;

  while (i < args.length) {
    const tok = args[i];
    if (tok === "--exclude") {
      const next = args[i + 1];
      if (!next || next.startsWith("--"))
        return { error: "Missing value for `--exclude`." };
      excludeRoleId = next.replace(/[<@&>]/g, "");
      i += 2;
    } else if (tok === "--include") {
      const next = args[i + 1];
      if (!next || next.startsWith("--"))
        return { error: "Missing value for `--include`." };
      includeRoleId = next.replace(/[<@&>]/g, "");
      i += 2;
    } else if (tok === "--reason") {
      reasonParts.push(...args.slice(i + 1));
      i = args.length;
    } else {
      i++;
    }
  }

  return {
    action,
    roleId,
    excludeRoleId,
    includeRoleId,
    reason: reasonParts.join(" ").trim() || "No reason provided",
  };
}

function _buildAuditReason(executor, action, reason) {
  const prefix = `${action} by ${executor.tag} (${executor.id}) | `;
  return `${prefix}${reason}`.slice(0, MAX_AUDIT_REASON_LENGTH);
}

export default new RoleAllCommand();
