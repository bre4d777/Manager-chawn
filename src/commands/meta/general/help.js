import { Command } from '#command';
import {
	MessageFlags,
	ButtonStyle,
	ActionRowBuilder,
	ButtonBuilder,
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
} from 'discord.js';
import { config } from '#config';
import { emoji } from '#emoji';
import { disableComponents, logger } from '#utils';

const { colors } = config;
const CMDS_PER_PAGE = 8;

class HelpCommand extends Command {
	constructor() {
		super({
			name: 'help',
			description: 'Browse commands or get info on a specific command',
			usage: 'help [command]',
			aliases: ['h', 'cmds', 'commands'],
			cooldown: 10,
			enabledSlash: true,
			slashData: {
				name: 'help',
				description: 'Browse commands or get info on a specific command',
				options: [
					{
						name: 'command',
						description: 'Get info about a specific command',
						type: 3,
						required: false,
						autocomplete: true,
					},
				],
			},
		});
	}

	async execute({ ctx }) {
		const arg = ctx.isSlash
			? ctx.options?.getString('command')
			: ctx.args.join(' ').trim();

		if (arg) {
			const command = this._findCommand(ctx.client, arg);
			const hidden = command?.category?.toLowerCase().includes('dev');
			if (!command || hidden) {
				const container = new ContainerBuilder();
				container.setAccentColor(colors.error ?? 0xff4444);
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`## ${emoji.cross} Command Not Found\n\nNo command matching \`${arg}\` was found.`,
					),
				);
				return ctx.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
			}
			const container = this._buildDetailsView(command, null, 0);
			await ctx.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
			const message = await ctx.fetchReply();
			return this._startCollector(ctx, message);
		}

		const categories = this._getCategories(ctx.client);
		const firstCat = Object.keys(categories).sort()[0] ?? null;
		const container = this._buildMainView(ctx.client, firstCat, 0);

		await ctx.reply({
			components: [container],
			flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
		});

		const message = await ctx.fetchReply();
		this._startCollector(ctx, message);
	}

	async autocomplete({ interaction, client }) {
		try {
			const focused = interaction.options.getFocused().toLowerCase();
			const results = [];
			const seen = new Set();

			for (const cmd of client.commandHandler.commands.values()) {
				if (cmd.category?.toLowerCase().includes('dev')) continue;
				const key = this._cmdKey(cmd);
				if (seen.has(key)) continue;
				seen.add(key);
				const display = this._cmdDisplay(cmd);
				if (display.toLowerCase().includes(focused)) {
					results.push({ name: display, value: key });
				}
				if (results.length >= 25) break;
			}

			await interaction.respond(results);
		} catch (err) {
			logger.error('Help', 'Autocomplete error', err);
		}
	}

	_startCollector(ctx, message) {
		const collector = message.createMessageComponentCollector({
			time: 600_000,
			filter: (i) => {
				if (i.user.id !== ctx.author.id) {
					void i.reply({
						content: `${emoji.cross} Not your command.`,
						flags: MessageFlags.Ephemeral,
					}).catch(() => {});
					return false;
				}
				return true;
			},
		});

		collector.on('collect', async (interaction) => {
			try {
				await interaction.deferUpdate();
				const [action, p1, p2] = interaction.customId.split('|');

				if (action === 'hcat') {
					const container = this._buildMainView(ctx.client, p1, 0);
					await message.edit({ components: [container] });
					return;
				}

				if (action === 'hpage') {
					const container = this._buildMainView(ctx.client, p1, parseInt(p2));
					await message.edit({ components: [container] });
					return;
				}

				if (action === 'hback') {
					const container = this._buildMainView(ctx.client, p1, parseInt(p2));
					await message.edit({ components: [container] });
					return;
				}

				if (interaction.isStringSelectMenu()) {
					if (action === 'hcatsel') {
						const cat = interaction.values[0];
						const container = this._buildMainView(ctx.client, cat, 0);
						await message.edit({ components: [container] });
						return;
					}
					if (action === 'hcmdsel') {
						const [cmdKey, cat, page] = interaction.values[0].split('::');
						const command = this._findCommand(ctx.client, cmdKey);
						if (!command) return;
						const container = this._buildDetailsView(command, cat, parseInt(page) || 0);
						await message.edit({ components: [container] });
					}
				}
			} catch (err) {
				logger.error('Help', 'Interaction error', err);
			}
		});

		collector.on('end', async () => {
			try {
				await disableComponents(message);
			} catch {}
		});
	}

	_buildMainView(client, selectedCat, page) {
		const categories = this._getCategories(client);
		const container = new ContainerBuilder();
		container.setAccentColor(colors.bot);

		const totalCmds = this._totalCmdCount(client);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`## Commands\n-# ${totalCmds} commands across ${Object.keys(categories).length} categories`,
			),
		);

		container.addSeparatorComponents(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
		);

		const catNames = Object.keys(categories).sort();

		if (catNames.length === 0) {
				container.addTextDisplayComponents(
						new TextDisplayBuilder().setContent('-# No categories available.'),
				);
		} else {
				const chunks = [];
				for (let i = 0; i < catNames.length; i += 25) {
						chunks.push(catNames.slice(i, i + 25));
				}

				for (let ci = 0; ci < chunks.length; ci++) {
						const chunk = chunks[ci];
						const catOptions = chunk.map((name) =>
								new StringSelectMenuOptionBuilder()
										.setLabel(this._formatCatName(name))
										.setValue(name)
										.setDefault(name === selectedCat),
						);

						container.addActionRowComponents(
								new ActionRowBuilder().addComponents(
										new StringSelectMenuBuilder()
												.setCustomId(`hcatsel|${ci}|_`)
												.setPlaceholder(chunks.length > 1 ? `Categories (${ci + 1}/${chunks.length})` : 'Select a category...')
												.addOptions(catOptions),
								),
						);
				}
		}

		if (selectedCat && categories[selectedCat]) {
			container.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
			);

			const cmds = categories[selectedCat];
			const totalPages = Math.ceil(cmds.length / CMDS_PER_PAGE);
			const safePage = Math.max(0, Math.min(page, totalPages - 1));
			const pageCmds = cmds.slice(
				safePage * CMDS_PER_PAGE,
				safePage * CMDS_PER_PAGE + CMDS_PER_PAGE,
			);

			const listText = pageCmds
				.map(
					(cmd) =>
						`* **${this._cmdDisplay(cmd)}** — ${this._trunc(cmd.description || 'No description', 55)}`,
				)
				.join('\n');

			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`${listText}\n\n-# ${this._formatCatName(selectedCat)} • Page ${safePage + 1}/${totalPages} • ${cmds.length} commands`,
				),
			);

			const cmdOptions = pageCmds.map((cmd) => {
				const key = this._cmdKey(cmd);
				return new StringSelectMenuOptionBuilder()
					.setLabel(this._trunc(this._cmdDisplay(cmd), 100))
					.setValue(`${key}::${selectedCat}::${safePage}`)
					.setDescription(this._trunc(cmd.description || 'No description', 100));
			});

			container.addActionRowComponents(
				new ActionRowBuilder().addComponents(
					new StringSelectMenuBuilder()
						.setCustomId('hcmdsel|_|_')
						.setPlaceholder('Select a command for details...')
						.addOptions(cmdOptions),
				),
			);

			if (totalPages > 1) {
				container.addActionRowComponents(
					new ActionRowBuilder().addComponents(
						new ButtonBuilder()
							.setCustomId(`hpage|${selectedCat}|${safePage - 1}`)
							.setStyle(ButtonStyle.Secondary)
							.setEmoji('◀️')
							.setDisabled(safePage === 0),
						new ButtonBuilder()
							.setCustomId(`hpage|${selectedCat}|${safePage + 1}`)
							.setStyle(ButtonStyle.Secondary)
							.setEmoji('▶️')
							.setDisabled(safePage === totalPages - 1),
					),
				);
			}
		}

		return container;
	}

	_buildDetailsView(command, fromCat, fromPage) {
		const container = new ContainerBuilder();
		container.setAccentColor(colors.bot);

		const display = this._cmdDisplay(command);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`## ${display}`),
		);

		container.addSeparatorComponents(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
		);

		const lines = [];
		lines.push(command.description || 'No description available.');

		if (command.usage) lines.push(`* **Usage:** \`${command.usage}\``);
		if (command.cooldown) lines.push(`* **Cooldown:** ${command.cooldown}s`);
		if (command.aliases?.length)
			lines.push(`* **Aliases:** ${command.aliases.map((a) => `\`${a}\``).join(', ')}`);
		if (command.examples?.length)
			lines.push(`* **Examples:** ${command.examples.map((e) => `\`${e}\``).join(', ')}`);
		if (command.userPermissions?.length)
			lines.push(
				`* **User Perms:** ${command.userPermissions.map((p) => this._formatPerm(p)).join(', ')}`,
			);
		if (command.permissions?.length)
			lines.push(
				`* **Bot Perms:** ${command.permissions.map((p) => this._formatPerm(p)).join(', ')}`,
			);
		if (command.enabledSlash && command.slashData) {
			const slashName = Array.isArray(command.slashData.name)
				? `/${command.slashData.name.join(' ')}`
				: `/${command.slashData.name}`;
			lines.push(`* **Slash:** \`${slashName}\``);
		}

		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(lines.join('\n')),
		);

		if (fromCat) {
			container.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
			);
			container.addActionRowComponents(
				new ActionRowBuilder().addComponents(
					new ButtonBuilder()
						.setCustomId(`hback|${fromCat}|${fromPage}`)
						.setLabel('Back')
						.setStyle(ButtonStyle.Secondary)
						.setEmoji('◀️'),
				),
			);
		}

		return container;
	}

	_getCategories(client) {
		const categories = {};

		for (const [catName, cmds] of client.commandHandler.categories.entries()) {
			if (catName.toLowerCase().includes('dev')) continue;
			const top = catName.split('/')[0];
			if (!categories[top]) categories[top] = [];
			for (const cmd of cmds) {
				if (!cmd.category?.toLowerCase().includes('dev')) {
					categories[top].push(cmd);
				}
			}
		}

		for (const key in categories) {
			if (categories[key].length === 0) delete categories[key];
		}

		return categories;
	}

	_totalCmdCount(client) {
		return Array.from(client.commandHandler.commands.values()).filter(
			(cmd) => !cmd.category?.toLowerCase().includes('dev'),
		).length;
	}

	_findCommand(client, key) {
		if (!key) return null;
		const normalized = key.toLowerCase().trim();
		const colonKey = normalized.replace(/\s+/g, ':');

		let cmd = client.commandHandler.commands.get(colonKey);
		if (cmd) return cmd;

		cmd = client.commandHandler.commands.get(normalized);
		if (cmd) return cmd;

		const aliasTarget = client.commandHandler.aliases.get(normalized);
		if (aliasTarget) {
			cmd = client.commandHandler.commands.get(aliasTarget);
			const hidden = cmd?.category?.toLowerCase().includes('dev')
			if (cmd && !hidden) return cmd;
		}

		for (const c of client.commandHandler.commands.values()) {
			if (Array.isArray(c.name)) {
				if (
					c.name.join(':').toLowerCase() === colonKey ||
					c.name.join(' ').toLowerCase() === normalized
				)
					return c;
			}
		}

		return null;
	}

	_cmdKey(cmd) {
		return Array.isArray(cmd.name)
			? cmd.name.join(':').toLowerCase()
			: cmd.name.toLowerCase();
	}

	_cmdDisplay(cmd) {
		return Array.isArray(cmd.name) ? cmd.name.join(' ') : cmd.name;
	}

	_formatCatName(name) {
		return name
			.split(/[-_/]/)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ');
	}
	_formatPerm(perm) {
		const map = {
			1n: 'Create Invites',
			2n: 'Kick Members',
			4n: 'Ban Members',
			8n: 'Administrator',
			16n: 'Manage Channels',
			32n: 'Manage Guild',
			64n: 'Add Reactions',
			128n: 'View Audit Log',
			256n: 'Priority Speaker',
			512n: 'Stream',
			1024n: 'View Channel',
			2048n: 'Send Messages',
			4096n: 'Send TTS Messages',
			8192n: 'Manage Messages',
			16384n: 'Embed Links',
			32768n: 'Attach Files',
			65536n: 'Read Message History',
			131072n: 'Mention Everyone',
			262144n: 'Use External Emojis',
			524288n: 'View Guild Insights',
			1048576n: 'Connect',
			2097152n: 'Speak',
			4194304n: 'Mute Members',
			8388608n: 'Deafen Members',
			16777216n: 'Move Members',
			33554432n: 'Use VAD',
			67108864n: 'Change Nickname',
			134217728n: 'Manage Nicknames',
			268435456n: 'Manage Roles',
			536870912n: 'Manage Webhooks',
			1073741824n: 'Manage Emojis And Stickers',
			2147483648n: 'Use Application Commands',
			4294967296n: 'Request To Speak',
			8589934592n: 'Manage Events',
			17179869184n: 'Manage Threads',
			34359738368n: 'Create Public Threads',
			68719476736n: 'Create Private Threads',
			137438953472n: 'Use External Stickers',
			274877906944n: 'Send Messages In Threads',
			549755813888n: 'Use Embedded Activities',
			1099511627776n: 'Moderate Members',
			2199023255552n: 'View Creator Monetization Analytics',
			4398046511104n: 'Use Soundboard',
			17592186044416n: 'Use External Sounds',
			35184372088832n: 'Send Voice Messages',
			70368744177664n: 'Use Stage Discovery',
			140737488355328n: 'Sponsor',
			281474976710656n: 'Send Media Messages',
		};

		if (typeof perm === 'bigint') return map[perm] ?? `Unknown (${perm}n)`;
		if (typeof perm === 'string') return perm.replace(/([A-Z])/g, ' $1').trim();
		return String(perm);
	}

	_trunc(text, max) {
		if (!text || text.length <= max) return text ?? '';
		return text.slice(0, max - 3) + '...';
	}
}

export default new HelpCommand();
