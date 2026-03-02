import { Command } from '#command';
import {
	MessageFlags,
	ButtonStyle,
	ButtonBuilder,
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	SectionBuilder,
} from 'discord.js';
import { emoji } from '#emoji';
import { config } from '#config';

class SupportCommand extends Command {
	constructor() {
		super({
			name: ['support'],
			description: 'Join support server',
			aliases: ['help-server', 'discord', 'server'],
			cooldown: 120,
			enabledSlash: true,
			slashData: {
				name: 'support',
				description: 'Join support server',
			},
		});
	}

	async execute({ ctx }) {
		await ctx.reply({
			components: [this._view()],
			flags: MessageFlags.IsComponentsV2,
		});
	}

	_view() {
		const container = new ContainerBuilder();
		container.setAccentColor(config.colors.bot);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`### Support Server`),
		);

		container.addSeparatorComponents(
			new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
		);
		container.addSectionComponents(
			new SectionBuilder()
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`* ${emoji.settings} Help with commands, setup, and issues\n` +
							`* ${emoji.fix} Report bugs and unexpected behavior\n` +
							`* ${emoji.activity} Get update announcements\n` +
							`* ${emoji.code} Suggest and discuss features`,
					),
				)
				.setButtonAccessory(
					new ButtonBuilder()
						.setStyle(ButtonStyle.Link)
						.setLabel('Join Support Server')
						.setURL(config.links.supportServer),
				),
		);

		return container;
	}
}

export default new SupportCommand();
