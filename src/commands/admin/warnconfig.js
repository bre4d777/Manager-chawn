import { Command } from "#command";
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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { config } from "#config";
import { db } from "#dbManager";
import { emoji } from "#emoji";
import { disableComponents, logger } from "#utils";

const { colors } = config;

const ACTION_LABELS = {
  timeout: "Timeout",
  kick: "Kick",
  ban: "Ban",
};

class WarnConfigCommand extends Command {
  constructor() {
    super({
      name: "warnconfig",
      description: "Configure automatic punishments for warn thresholds",
      usage: "warnconfig",
      aliases: ["warnsettings", "warnsetup"],
      cooldown: 10,
      userPermissions: [PermissionFlagsBits.ManageGuild],
      permissions: [],
      enabledSlash: true,
      slashData: {
        name: "warnconfig",
        description: "Configure automatic punishments for warn thresholds",
        defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
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

    const cfg = await db.warns.getConfig(ctx.guild.id);

    await ctx.reply({
      components: [_renderEditor(cfg.thresholds)],
      flags: MessageFlags.IsComponentsV2,
    });

    const message = await ctx.fetchReply();
    _startCollector(ctx, message);
  }
}

function _renderEditor(thresholds, feedback = null) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.bot);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Warn Thresholds"),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true),
  );

  const body =
    thresholds.length > 0
      ? thresholds
          .map((t) => {
            const label = ACTION_LABELS[t.action] ?? t.action;
            const detail =
              t.action === "timeout" && t.duration
                ? ` (${db.warns.formatDuration(t.duration)})`
                : "";
            return `* **${t.count} warns** → ${label}${detail}`;
          })
          .join("\n")
      : "No thresholds configured.";

  const feedbackText = feedback ? `\n\n${feedback}` : "";
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${body}${feedbackText}\n\n-# ${thresholds.length} threshold${thresholds.length === 1 ? "" : "s"} set`,
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("wc|add_timeout")
        .setLabel("Add Timeout")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("wc|add_kick")
        .setLabel("Add Kick")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("wc|add_ban")
        .setLabel("Add Ban")
        .setStyle(ButtonStyle.Danger),
    ),
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("wc|remove")
        .setLabel("Remove Threshold")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(thresholds.length === 0),
      new ButtonBuilder()
        .setCustomId("wc|clear")
        .setLabel("Clear All")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(thresholds.length === 0),
    ),
  );

  return container;
}

function _startCollector(ctx, message) {
  const collector = message.createMessageComponentCollector({
    time: 300_000,
    filter: (i) => {
      if (i.user.id !== ctx.author.id) {
        i.reply({
          content: `${emoji.cross} Not your command dude, use your own command.`,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return false;
      }
      return true;
    },
  });

  collector.on("collect", async (i) => {
    try {
      const [, action] = i.customId.split("|");

      if (action === "clear") {
        await i.deferUpdate();
        await db.warns.clearThresholds(ctx.guild.id);
        const updated = await db.warns.getConfig(ctx.guild.id);
        await message.edit({
          components: [
            _renderEditor(
              updated.thresholds,
              `${emoji.check} All thresholds cleared.`,
            ),
          ],
        });
        _clearFeedback(ctx.guild.id, message);
        return;
      }

      if (action === "add_timeout") {
        const modal = new ModalBuilder()
          .setCustomId(`wc_modal_${i.id}`)
          .setTitle("Add Timeout Threshold");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("warn_count")
              .setLabel("Warn count to trigger timeout")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("e.g. 3")
              .setRequired(true)
              .setMaxLength(4),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("duration")
              .setLabel("Timeout duration")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("e.g. 10m, 2h, 1d (max 28d)")
              .setRequired(true)
              .setMaxLength(10),
          ),
        );

        await i.showModal(modal);

        const submit = await i
          .awaitModalSubmit({
            filter: (s) => s.customId === `wc_modal_${i.id}`,
            time: 120_000,
          })
          .catch(() => null);

        if (!submit) return;
        await submit.deferUpdate();

        const cfg = await db.warns.getConfig(ctx.guild.id);
        const count = parseInt(
          submit.fields.getTextInputValue("warn_count"),
          10,
        );
        const rawDuration = submit.fields.getTextInputValue("duration").trim();
        const duration = db.warns.parseDuration(rawDuration);

        if (isNaN(count) || count < 1) {
          await message.edit({
            components: [
              _renderEditor(
                cfg.thresholds,
                `${emoji.cross} Invalid warn count. Must be a positive number.`,
              ),
            ],
          });
          _clearFeedback(ctx.guild.id, message);
          return;
        }

        if (!duration) {
          await message.edit({
            components: [
              _renderEditor(
                cfg.thresholds,
                `${emoji.cross} Invalid duration \`${rawDuration}\`. Use formats like \`10m\`, \`2h\`, \`1d\`.`,
              ),
            ],
          });
          _clearFeedback(ctx.guild.id, message);
          return;
        }

        try {
          const updated = await db.warns.addThreshold(
            ctx.guild.id,
            count,
            "timeout",
            duration,
          );
          await message.edit({
            components: [
              _renderEditor(
                updated,
                `${emoji.check} Added timeout at **${count} warns** (${db.warns.formatDuration(duration)}).`,
              ),
            ],
          });
        } catch (err) {
          await message.edit({
            components: [
              _renderEditor(cfg.thresholds, `${emoji.cross} ${err.message}`),
            ],
          });
        }
        _clearFeedback(ctx.guild.id, message);
        return;
      }

      if (action === "add_kick" || action === "add_ban") {
        const actionName = action === "add_kick" ? "kick" : "ban";
        const label = action === "add_kick" ? "Kick" : "Ban";

        const modal = new ModalBuilder()
          .setCustomId(`wc_modal_${i.id}`)
          .setTitle(`Add ${label} Threshold`);

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("warn_count")
              .setLabel(`Warn count to trigger ${label.toLowerCase()}`)
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("e.g. 5")
              .setRequired(true)
              .setMaxLength(4),
          ),
        );

        await i.showModal(modal);

        const submit = await i
          .awaitModalSubmit({
            filter: (s) => s.customId === `wc_modal_${i.id}`,
            time: 120_000,
          })
          .catch(() => null);

        if (!submit) return;
        await submit.deferUpdate();

        const cfg = await db.warns.getConfig(ctx.guild.id);
        const count = parseInt(
          submit.fields.getTextInputValue("warn_count"),
          10,
        );

        if (isNaN(count) || count < 1) {
          await message.edit({
            components: [
              _renderEditor(
                cfg.thresholds,
                `${emoji.cross} Invalid warn count. Must be a positive number.`,
              ),
            ],
          });
          _clearFeedback(ctx.guild.id, message);
          return;
        }

        try {
          const updated = await db.warns.addThreshold(
            ctx.guild.id,
            count,
            actionName,
          );
          await message.edit({
            components: [
              _renderEditor(
                updated,
                `${emoji.check} Added ${label} threshold at **${count} warns**.`,
              ),
            ],
          });
        } catch (err) {
          await message.edit({
            components: [
              _renderEditor(cfg.thresholds, `${emoji.cross} ${err.message}`),
            ],
          });
        }
        _clearFeedback(ctx.guild.id, message);
        return;
      }

      if (action === "remove") {
        const cfg = await db.warns.getConfig(ctx.guild.id);

        const modal = new ModalBuilder()
          .setCustomId(`wc_modal_${i.id}`)
          .setTitle("Remove Threshold");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("warn_count")
              .setLabel("Warn count of threshold to remove")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder(
                cfg.thresholds.length > 0
                  ? `e.g. ${cfg.thresholds[0].count}`
                  : "e.g. 3",
              )
              .setRequired(true)
              .setMaxLength(4),
          ),
        );

        await i.showModal(modal);

        const submit = await i
          .awaitModalSubmit({
            filter: (s) => s.customId === `wc_modal_${i.id}`,
            time: 120_000,
          })
          .catch(() => null);

        if (!submit) return;
        await submit.deferUpdate();

        const count = parseInt(
          submit.fields.getTextInputValue("warn_count"),
          10,
        );

        if (isNaN(count) || count < 1) {
          await message.edit({
            components: [
              _renderEditor(
                cfg.thresholds,
                `${emoji.cross} Invalid warn count.`,
              ),
            ],
          });
          _clearFeedback(ctx.guild.id, message);
          return;
        }

        try {
          const updated = await db.warns.removeThreshold(ctx.guild.id, count);
          await message.edit({
            components: [
              _renderEditor(
                updated,
                `${emoji.check} Removed threshold at **${count} warns**.`,
              ),
            ],
          });
        } catch (err) {
          await message.edit({
            components: [
              _renderEditor(cfg.thresholds, `${emoji.cross} ${err.message}`),
            ],
          });
        }
        _clearFeedback(ctx.guild.id, message);
      }
    } catch (err) {
      logger.error("WarnConfig", "Interaction error", err);
    }
  });

  collector.on("end", async () => {
    try {
      await disableComponents(message);
    } catch {}
  });
}

function _clearFeedback(guildId, message) {
  setTimeout(async () => {
    try {
      const cfg = await db.warns.getConfig(guildId);
      await message.edit({ components: [_renderEditor(cfg.thresholds)] });
    } catch {}
  }, 3_000);
}

function _errorView(description) {
  const container = new ContainerBuilder();
  container.setAccentColor(colors.error ?? 0xe74c3c);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Error\n\n${description}`),
  );
  return container;
}

export default new WarnConfigCommand();
