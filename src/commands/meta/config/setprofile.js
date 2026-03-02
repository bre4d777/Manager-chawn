import { Command } from '#command';
import {
	PermissionFlagsBits,
	MessageFlags,
	ButtonStyle,
	ActionRowBuilder,
	ButtonBuilder,
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	FileUploadBuilder,
	LabelBuilder,
	SectionBuilder,
} from 'discord.js';
import { REST } from '@discordjs/rest';
import { db } from '#dbManager';
import { config } from '#config';
import { emoji } from '#emoji';
const { colors } = config;
import { disableComponents } from '#utils';

class SetProfileCommand extends Command {
	constructor() {
		super({
			name: 'setprofile',
			description: "Customize bot's server profile",
			usage: 'setprofile',
			aliases: ['botprofile'],
			cooldown: 600,
			userPermissions: [PermissionFlagsBits.ManageGuild],
			enabledSlash: true,
			slashData: {
				name: 'setprofile',
				description: "Customize bot's server profile",
				defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
			},
		});
	}

	async execute({ ctx }) {
		if (!ctx.guild) {
			const container = new ContainerBuilder();
			container.setAccentColor(colors.error);
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					'## Server Only\n\nThis command can only be used in a server.',
				),
			);
			return ctx.reply({
				components: [container],
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
			});
		}
		const container = await this._buildHome(ctx.guild.id);
		await ctx.reply({
			components: [container],
			flags: MessageFlags.IsComponentsV2,
		});

		const message = await ctx.fetchReply();
		const collector = message.createMessageComponentCollector({
			time: 300_000,
			filter: (i) => {
				if (i.user.id !== ctx.author.id) {
					i.reply({
						content: `${emoji.cross} Not your command dude, Use ur own command `,
						flags: MessageFlags.Ephemeral,
					});
					return false;
				}
				return true;
			},
		});

		collector.on('collect', async (interaction) => {
			try {
				if (interaction.customId === 'profile_avatar') {
					await this._handleAvatar(interaction, ctx.guild.id, message);
				} else if (interaction.customId === 'profile_banner') {
					await this._handleBanner(interaction, ctx.guild.id, message);
				} else if (interaction.customId === 'profile_bio') {
					await this._handleBio(interaction, ctx.guild.id, message);
				} else if (interaction.customId === 'reset_profile') {
					await this._handleReset(interaction, ctx.guild.id, message);
				}
			} catch (error) {
				if (!interaction.replied && !interaction.deferred) {
					const container = new ContainerBuilder();
					container.setAccentColor(colors.error);
					container.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(
							'## Error\n\nAn error occurred while processing your request.',
						),
					);
					await interaction.reply({
						components: [container],
						flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
					});
				}
			}
		});

		collector.on('end', async () => {
			try {
				await disableComponents(message);
			} catch {}
		});
	}

	_checkCooldown(lastUpdate) {
		if (!lastUpdate) return null;
		const timeSince = Date.now() - new Date(lastUpdate).getTime();
		const hoursLeft = Math.ceil((10800000 - timeSince) / 3600000);
		if (timeSince < 10800000) {
			return `This can only be updated once every 3 hours. Try again in ${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}.`;
		}
		return null;
	}

	async _buildHome(guildId) {
		const isCustomProfile = await db.guild.getCustomProfileStatus(guildId);
		const container = new ContainerBuilder();
		container.setAccentColor(colors.bot);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('## Bot Profile Customization'),
		);

		container.addSeparatorComponents(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
		);

		container.addSectionComponents(
			new SectionBuilder()
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						"Customize the bot's appearance in this server:\n\n" +
							'**Avatar** - Set custom profile picture\n' +
							'**Banner** - Set custom profile banner\n' +
							'**Bio** - Set custom about me text\n\n' +
							'-# Each can be updated once every 3 hours',
					),
				)
				.setButtonAccessory(
					new ButtonBuilder()
						.setCustomId('reset_profile')
						.setLabel('Reset')
						.setStyle(ButtonStyle.Secondary)
						.setDisabled(!isCustomProfile),
				),
		);

		container.addSeparatorComponents(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
		);

		const buttons = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId('profile_avatar')
				.setLabel('Avatar')
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId('profile_banner')
				.setLabel('Banner')
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId('profile_bio')
				.setLabel('Bio')
				.setStyle(ButtonStyle.Secondary),
		);

		container.addActionRowComponents(buttons);
		return container;
	}

	async _handleReset(interaction, guildId, originalMessage) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const rest = new REST({ version: '10' }).setToken(interaction.client.token);
		await rest.patch(`/guilds/${interaction.guildId}/members/@me`, {
			body: { avatar: null, banner: null, bio: null },
		});
		await db.guild.setCustomProfileStatus(guildId, false);

		const updatedContainer = await this._buildHome(guildId);
		await originalMessage.edit({
			components: [updatedContainer],
		});

		const container = new ContainerBuilder();
		container.setAccentColor(colors.success);
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				'## Profile Reset\n\nBot profile has been reset to default',
			),
		);

		await interaction.editReply({
			components: [container],
			flags: MessageFlags.IsComponentsV2,
		});
	}

	async _handleAvatar(interaction, guildId, originalMessage) {
		const lastUpdate = await db.guild.getAvatarUpdatedAt(guildId);
		const cooldownMsg = this._checkCooldown(lastUpdate);

		if (cooldownMsg) {
			const container = new ContainerBuilder();
			container.setAccentColor(colors.error);
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`## Cooldown Active\n\n${cooldownMsg}`),
			);
			return interaction.reply({
				components: [container],
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
			});
		}

		const modal = new ModalBuilder()
			.setCustomId('modal_avatar')
			.setTitle('Set Bot Avatar');

		const fileUpload = new FileUploadBuilder()
			.setCustomId('avatar_file')
			.setRequired(true)
			.setMinValues(1)
			.setMaxValues(1);

		const label = new LabelBuilder()
			.setLabel('Upload Avatar Image')
			.setDescription('PNG, JPG, GIF or WEBP format')
			.setFileUploadComponent(fileUpload);

		modal.addLabelComponents(label);

		await interaction.showModal(modal);

		const filter = (i) =>
			i.customId === 'modal_avatar' && i.user.id === interaction.user.id;

		const submitted = await interaction
			.awaitModalSubmit({ filter, time: 300_000 })
			.catch(() => null);

		if (!submitted) return;

		await submitted.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const files = submitted.fields.getUploadedFiles('avatar_file');

			if (files.size === 0) {
				const container = new ContainerBuilder();
				container.setAccentColor(colors.error);
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						'## No File Uploaded\n\nPlease upload an image file.',
					),
				);
				return submitted.editReply({
					components: [container],
					flags: MessageFlags.IsComponentsV2,
				});
			}

			const file = files.first();

			if (!file.contentType?.startsWith('image/')) {
				const container = new ContainerBuilder();
				container.setAccentColor(colors.error);
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						'## Invalid File Type\n\nPlease upload an image file.',
					),
				);
				return submitted.editReply({
					components: [container],
					flags: MessageFlags.IsComponentsV2,
				});
			}

			const response = await fetch(file.url);
			if (!response.ok) {
				const container = new ContainerBuilder();
				container.setAccentColor(colors.error);
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						'## Failed to Fetch Image\n\nPlease try again.',
					),
				);
				return submitted.editReply({
					components: [container],
					flags: MessageFlags.IsComponentsV2,
				});
			}

			const buffer = Buffer.from(await response.arrayBuffer());
			const base64Data = `data:${file.contentType};base64,${buffer.toString('base64')}`;

			const rest = new REST({ version: '10' }).setToken(interaction.client.token);
			await rest.patch(`/guilds/${interaction.guildId}/members/@me`, {
				body: { avatar: base64Data },
			});

			await db.guild.setAvatarUpdatedAt(guildId);
			await db.guild.setCustomProfileStatus(guildId, true);

			const updatedContainer = await this._buildHome(guildId);
			await originalMessage.edit({
				components: [updatedContainer],
			});

			const container = new ContainerBuilder();
			container.setAccentColor(colors.success);
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					'## Avatar Updated\n\nSuccessfully updated bot avatar for this server!',
				),
			);

			await submitted.editReply({
				components: [container],
				flags: MessageFlags.IsComponentsV2,
			});
		} catch (error) {
			const container = new ContainerBuilder();
			container.setAccentColor(colors.error);
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					'## Failed to Update Avatar\n\nPlease try again.',
				),
			);
			await submitted.editReply({
				components: [container],
				flags: MessageFlags.IsComponentsV2,
			});
		}
	}

	async _handleBanner(interaction, guildId, originalMessage) {
		const lastUpdate = await db.guild.getBannerUpdatedAt(guildId);
		const cooldownMsg = this._checkCooldown(lastUpdate);

		if (cooldownMsg) {
			const container = new ContainerBuilder();
			container.setAccentColor(colors.error);
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`## Cooldown Active\n\n${cooldownMsg}`),
			);
			return interaction.reply({
				components: [container],
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
			});
		}

		const modal = new ModalBuilder()
			.setCustomId('modal_banner')
			.setTitle('Set Bot Banner');

		const fileUpload = new FileUploadBuilder()
			.setCustomId('banner_file')
			.setRequired(true)
			.setMinValues(1)
			.setMaxValues(1);

		const label = new LabelBuilder()
			.setLabel('Upload Banner Image')
			.setDescription('PNG, JPG, GIF or WEBP format')
			.setFileUploadComponent(fileUpload);

		modal.addLabelComponents(label);

		await interaction.showModal(modal);

		const filter = (i) =>
			i.customId === 'modal_banner' && i.user.id === interaction.user.id;

		const submitted = await interaction
			.awaitModalSubmit({ filter, time: 300_000 })
			.catch(() => null);

		if (!submitted) return;

		await submitted.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const files = submitted.fields.getUploadedFiles('banner_file');

			if (files.size === 0) {
				const container = new ContainerBuilder();
				container.setAccentColor(colors.error);
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						'## No File Uploaded\n\nPlease upload an image file.',
					),
				);
				return submitted.editReply({
					components: [container],
					flags: MessageFlags.IsComponentsV2,
				});
			}

			const file = files.first();

			if (!file.contentType?.startsWith('image/')) {
				const container = new ContainerBuilder();
				container.setAccentColor(colors.error);
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						'## Invalid File Type\n\nPlease upload an image file.',
					),
				);
				return submitted.editReply({
					components: [container],
					flags: MessageFlags.IsComponentsV2,
				});
			}

			const response = await fetch(file.url);
			if (!response.ok) {
				const container = new ContainerBuilder();
				container.setAccentColor(colors.error);
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						'## Failed to Fetch Image\n\nPlease try again.',
					),
				);
				return submitted.editReply({
					components: [container],
					flags: MessageFlags.IsComponentsV2,
				});
			}

			const buffer = Buffer.from(await response.arrayBuffer());
			const base64Data = `data:${file.contentType};base64,${buffer.toString('base64')}`;

			const rest = new REST({ version: '10' }).setToken(interaction.client.token);
			await rest.patch(`/guilds/${interaction.guildId}/members/@me`, {
				body: { banner: base64Data },
			});

			await db.guild.setBannerUpdatedAt(guildId);
			await db.guild.setCustomProfileStatus(guildId, true);

			const updatedContainer = await this._buildHome(guildId);
			await originalMessage.edit({
				components: [updatedContainer],
			});

			const container = new ContainerBuilder();
			container.setAccentColor(colors.success);
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					'## Banner Updated\n\nSuccessfully updated bot banner for this server!',
				),
			);

			await submitted.editReply({
				components: [container],
				flags: MessageFlags.IsComponentsV2,
			});
		} catch (error) {
			const container = new ContainerBuilder();
			container.setAccentColor(colors.error);
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					'## Failed to Update Banner\n\nPlease try again.',
				),
			);
			await submitted.editReply({
				components: [container],
				flags: MessageFlags.IsComponentsV2,
			});
		}
	}

	async _handleBio(interaction, guildId, originalMessage) {
		const lastUpdate = await db.guild.getBioUpdatedAt(guildId);
		const cooldownMsg = this._checkCooldown(lastUpdate);

		if (cooldownMsg) {
			const container = new ContainerBuilder();
			container.setAccentColor(colors.error);
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`## Cooldown Active\n\n${cooldownMsg}`),
			);
			return interaction.reply({
				components: [container],
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
			});
		}

		const modal = new ModalBuilder().setCustomId('modal_bio').setTitle('Set Bot Bio');

		const bioInput = new TextInputBuilder()
			.setCustomId('bio_text')
			.setStyle(TextInputStyle.Paragraph)
			.setPlaceholder('Enter bot bio (max 190 characters)')
			.setRequired(true)
			.setMinLength(2)
			.setMaxLength(190);

		const label = new LabelBuilder()
			.setLabel('Bio Text')
			.setDescription('Custom about me section')
			.setTextInputComponent(bioInput);

		modal.addLabelComponents(label);

		await interaction.showModal(modal);

		const filter = (i) => i.customId === 'modal_bio' && i.user.id === interaction.user.id;

		const submitted = await interaction
			.awaitModalSubmit({ filter, time: 300_000 })
			.catch(() => null);

		if (!submitted) return;

		await submitted.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const bioText = submitted.fields.getTextInputValue('bio_text');

			const rest = new REST({ version: '10' }).setToken(interaction.client.token);
			await rest.patch(`/guilds/${interaction.guildId}/members/@me`, {
				body: { bio: bioText },
			});

			await db.guild.setBioUpdatedAt(guildId);
			await db.guild.setCustomProfileStatus(guildId, true);

			const updatedContainer = await this._buildHome(guildId);
			await originalMessage.edit({
				components: [updatedContainer],
			});

			const container = new ContainerBuilder();
			container.setAccentColor(colors.success);
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`## Bio Updated\n\nSuccessfully updated bot bio for this server!\n\n-# ${bioText}`,
				),
			);

			await submitted.editReply({
				components: [container],
				flags: MessageFlags.IsComponentsV2,
			});
		} catch (error) {
			const container = new ContainerBuilder();
			container.setAccentColor(colors.error);
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					'## Failed to Update Bio\n\nPlease try again.',
				),
			);
			await submitted.editReply({
				components: [container],
				flags: MessageFlags.IsComponentsV2,
			});
		}
	}
}

export default new SetProfileCommand();
