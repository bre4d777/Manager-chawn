import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { config } from "#config";
import { Command } from "#command";
import { logger } from "#utils";
import emoji from "#emoji";

const LIMITS = {
  commandName: 32,
  commandDescription: 100,
  maxOptions: 25,
  optionName: 32,
  optionDescription: 100,
  maxChoices: 25,
  choiceName: 100,
  choiceValue: 100,
};

const OPTION_TYPE_NAMES = {
  1: "SUB_COMMAND",
  2: "SUB_COMMAND_GROUP",
  3: "STRING",
  4: "INTEGER",
  5: "BOOLEAN",
  6: "USER",
  7: "CHANNEL",
  8: "ROLE",
  9: "MENTIONABLE",
  10: "NUMBER",
  11: "ATTACHMENT",
};

class UpdateSlashCommand extends Command {
  constructor() {
    super({
      name: "slash",
      description: "Registers or updates all slash commands globally (Owner Only)",
      usage: "slash",
      aliases: ["slashupdate", "updateslash"],
      category: "developer",
      examples: ["slash"],
      ownerOnly: true,
      enabledSlash: false,
    });
  }

  async execute({ ctx }) {
    const msg = await ctx.reply(
      `${emoji.get("info")} **Scanning Commands**\nChecking for slash-enabled commands...`,
    );

    try {
      const slashCommandsData = ctx.client.commandHandler.getSlashCommandsData();

      if (!slashCommandsData || slashCommandsData.length === 0) {
        return msg.edit(
          `${emoji.get("info")} **No Commands Found**\nNo slash-enabled commands found to register.`,
        );
      }

      await msg.edit(
        `${emoji.get("info")} **Validating**\nFound **${slashCommandsData.length}** commands — running deep validation...`,
      );

      const errors = [];

      for (const cmdData of slashCommandsData) {
        const cmdErrors = _validateCommand(cmdData);
        if (cmdErrors.length > 0) {
          errors.push({ name: cmdData.name ?? "(unnamed)", issues: cmdErrors });
        }
      }

      if (errors.length > 0) {
        const lines = [`${emoji.get("cross")} **Validation Failed** — ${errors.length} command(s) have issues:\n`];

        for (const e of errors) {
          lines.push(`**\`/${e.name}\`**`);
          for (const issue of e.issues) {
            lines.push(`  • ${issue}`);
          }
        }

        logger.error("Slash", `Validation failed for ${errors.length} command(s)`);
        for (const e of errors) {
          logger.error("Slash", `/${e.name}: ${e.issues.join(" | ")}`);
        }

        const out = lines.join("\n");
        const chunks = _chunk(out, 1990);
        await msg.edit(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
          await ctx.channel.send(chunks[i]).catch(() => {});
        }
        return;
      }

      await msg.edit(
        `${emoji.get("info")} **Registering**\nValidation passed — pushing **${slashCommandsData.length}** commands to Discord...`,
      );

      const rest = new REST({ version: "10" }).setToken(config.token);

      await rest.put(Routes.applicationCommands(ctx.client.user.id), {
        body: slashCommandsData,
      });

      await msg.edit(
        `${emoji.get("check")} **Done**\nRegistered **${slashCommandsData.length}** commands successfully.\n-# Changes may take up to 1 hour to propagate globally.`,
      );

      logger.success("Slash", `Registered ${slashCommandsData.length} commands.`);
    } catch (error) {
      logger.error("Slash", "Registration failed", error);

      const detail = error?.rawError?.errors
        ? _flattenAPIErrors(error.rawError.errors)
        : error.message;

      await msg.edit(
        `${emoji.get("cross")} **Registration Failed**\n\`\`\`\n${detail}\n\`\`\`\nCheck console for full details.`,
      );
    }
  }
}

function _validateCommand(cmd, path = "") {
  const errors = [];
  const cmdPath = path || cmd.name

  if (!cmd.name) {
    errors.push(`[${cmdPath}] Missing \`name\`.`);
  } else {
    if (cmd.name.length > LIMITS.commandName) {
      errors.push(
        `[${cmdPath}] \`name\` is ${cmd.name.length} chars — max is ${LIMITS.commandName}. Value: "${cmd.name}"`,
      );
    }
    if (!/^[\da-z_-]+$/.test(cmd.name)) {
      errors.push(
        `[${cmdPath}] \`name\` "${cmd.name}" contains invalid characters (only lowercase letters, numbers, hyphens, underscores).`,
      );
    }
  }

  if (!cmd.description && cmd.type !== 1 && cmd.type !== 2) {
    errors.push(`[${cmdPath}] Missing \`description\`.`);
  } else if (cmd.description) {
    if (cmd.description.length > LIMITS.commandDescription) {
      errors.push(
        `[${cmdPath}] \`description\` is ${cmd.description.length} chars — max is ${LIMITS.commandDescription}. Value: "${cmd.description.slice(0, 60)}..."`,
      );
    }
    if (cmd.description.length < 1) {
      errors.push(`[${cmdPath}] \`description\` cannot be empty.`);
    }
  }

  if (cmd.options) {
    if (cmd.options.length > LIMITS.maxOptions) {
      errors.push(
        `[${cmdPath}] Has ${cmd.options.length} options — max is ${LIMITS.maxOptions}.`,
      );
    }

    for (const opt of cmd.options) {
      const optPath = `${cmdPath} > ${opt.name ?? "(unnamed option)"}`;
      const typeName = OPTION_TYPE_NAMES[opt.type] ?? `type(${opt.type})`;

      if (!opt.name) {
        errors.push(`[${optPath}] Missing \`name\`.`);
      } else if (opt.name.length > LIMITS.optionName) {
        errors.push(
          `[${optPath}] \`name\` is ${opt.name.length} chars — max is ${LIMITS.optionName}. Value: "${opt.name}"`,
        );
      }

      if (!opt.description) {
        errors.push(`[${optPath}] Missing \`description\`.`);
      } else if (opt.description.length > LIMITS.optionDescription) {
        errors.push(
          `[${optPath}] \`description\` is ${opt.description.length} chars — max is ${LIMITS.optionDescription}. Value: "${opt.description.slice(0, 60)}..."`,
        );
      }

      if (opt.choices) {
        if (opt.choices.length > LIMITS.maxChoices) {
          errors.push(
            `[${optPath}] Has ${opt.choices.length} choices — max is ${LIMITS.maxChoices}.`,
          );
        }
        for (let ci = 0; ci < opt.choices.length; ci++) {
          const choice = opt.choices[ci];
          const choicePath = `${optPath} > choice[${ci}]`;

          if (!choice.name) {
            errors.push(`[${choicePath}] Missing \`name\`.`);
          } else if (choice.name.length > LIMITS.choiceName) {
            errors.push(
              `[${choicePath}] \`name\` is ${choice.name.length} chars — max is ${LIMITS.choiceName}. Value: "${choice.name}"`,
            );
          }

          if (choice.value === undefined || choice.value === null) {
            errors.push(`[${choicePath}] Missing \`value\`.`);
          } else if (
            typeof choice.value === "string" &&
            choice.value.length > LIMITS.choiceValue
          ) {
            errors.push(
              `[${choicePath}] \`value\` is ${choice.value.length} chars — max is ${LIMITS.choiceValue}.`,
            );
          }
        }
      }

      if (opt.type === 1 || opt.type === 2) {
        const subErrors = _validateCommand(opt, optPath);
        errors.push(...subErrors);
      }
    }
  }

  return errors;
}

function _flattenAPIErrors(errors, path = "") {
  const lines = [];
  for (const [key, val] of Object.entries(errors)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (val._errors) {
      for (const e of val._errors) {
        lines.push(`[${fullPath}] ${e.code}: ${e.message}`);
      }
    }
    if (typeof val === "object" && !val._errors) {
      lines.push(..._flattenAPIErrors(val, fullPath));
    }
  }
  return lines.join("\n") || JSON.stringify(errors, null, 2);
}

function _chunk(text, size) {
  const chunks = [];
  while (text.length > 0) {
    chunks.push(text.slice(0, size));
    text = text.slice(size);
  }
  return chunks;
}

export default new UpdateSlashCommand();