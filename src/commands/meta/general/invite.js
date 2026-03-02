import { Command } from '#command';
import {
	MessageFlags,
	ButtonStyle,
	ButtonBuilder,
	ActionRowBuilder,
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
} from 'discord.js';
import { emoji } from '#emoji';
import { config } from '#config';
const { colors } = config;
class InviteCommand extends Command {
	constructor() {
		super({
			name: 'invite',
			description: 'Get the bot invite link and support server',
			usage: 'invite',
			aliases: ['inv', 'add'],
			examples: ['invite'],
			cooldown: 120,
			enabledSlash: true,
			slashData: {
				name: 'invite',
				description: 'Get the bot invite link and support server',
			},
		});
	}

	async execute({ ctx }) {
		const container = this._createInviteView(ctx);

		await ctx.reply({
			components: [container],
			flags: MessageFlags.IsComponentsV2,
		});
	}

	_createInviteView(ctx) {
		const container = new ContainerBuilder();
		const client = ctx.client;
		container.setAccentColor(colors.bot);

		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`## Invite ${client.user.username}`),
		);

		container.addSeparatorComponents(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
		);

		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Thanks for using **${client.user.username}**!\n\n` +
					`-# ${emoji.info} Click the buttons below to add the bot to your server or join our support server for help and updates.`,
			),
		);

		container.addSeparatorComponents(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
		);

		const buttons = new ActionRowBuilder();

		buttons.addComponents(
			new ButtonBuilder()
				.setStyle(ButtonStyle.Link)
				.setLabel('Invite Bot')
				.setURL(config.links.invite),

			new ButtonBuilder()
				.setStyle(ButtonStyle.Link)
				.setLabel('Support Server')
				.setURL(config.links.supportServer),
		);

		container.addActionRowComponents(buttons);

		return container;
	}
}

export default new InviteCommand();
