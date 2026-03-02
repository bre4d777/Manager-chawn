import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';

import { config } from '#config';
import { Command } from '#command';
import { logger } from '#utils';
import emoji from '#emoji';

class UpdateSlashCommand extends Command {
	constructor() {
		super({
			name: 'slash',
			description:
				'Registers or updates all slash commands with Discord globally (Owner Only)',
			usage: 'updateslash',
			aliases: ['slashupdate'],
			category: 'developer',
			examples: ['updateslash', 'slashupdate'],
			ownerOnly: true,
			enabledSlash: false,
		});
	}

	async execute({ ctx }) {
		const msg = await ctx.reply(
			`${emoji.get('info')} **Scanning Commands**\nChecking for slash-enabled commands...`,
		);

		try {
			const slashCommandsData = ctx.client.commandHandler.getSlashCommandsData();

			if (!slashCommandsData || slashCommandsData.length === 0) {
				return msg.edit(
					`${emoji.get('info')} **No Commands Found**\nNo slash-enabled commands found to register.`,
				);
			}

			const rest = new REST({ version: '10' }).setToken(config.token);

			await msg.edit(
				`${emoji.get('info')} **Validating Commands**\nFound ${slashCommandsData.length} commands - validating...`,
			);

			const nameRegex = /^[\da-z-]{1,32}$/;
			for (const cmdData of slashCommandsData) {
				if (!nameRegex.test(cmdData.name)) {
					logger.error(
						'UpdateSlash',
						`Validation failed for command name: ${cmdData.name}`,
					);
					return msg.edit(
						`${emoji.get('cross')} **Validation Failed**\nInvalid Command Name: \`${cmdData.name}\`\nNames must be 1-32 characters, lowercase, and contain only letters, numbers, and hyphens.`,
					);
				}
			}

			await msg.edit(
				`${emoji.get('info')} **Clearing Commands**\nClearing existing global commands...`,
			);

			await rest.put(Routes.applicationCommands(ctx.client.user.id), {
				body: [],
			});

			await msg.edit(
				`${emoji.get('info')} **Registering Commands**\nRegistering ${slashCommandsData.length} commands...`,
			);

			await rest.put(Routes.applicationCommands(ctx.client.user.id), {
				body: slashCommandsData,
			});

			await msg.edit(
				`${emoji.get('check')} **Update Complete**\nSuccessfully registered ${slashCommandsData.length} commands.\nCommands may take up to 1 hour to appear globally.`,
			);

			logger.success('UpdateSlash', `Registered ${slashCommandsData.length} commands.`);
		} catch (error) {
			logger.error('UpdateSlash', 'Failed to register slash commands', error);

			await msg.edit(
				`${emoji.get('cross')} **Registration Failed**\nAn error occurred while registering commands.\nCheck console logs for more details.`,
			);
		}
	}
}

export default new UpdateSlashCommand();
