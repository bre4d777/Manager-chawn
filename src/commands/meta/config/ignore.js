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
	ChannelSelectMenuBuilder,
	ChannelType,
} from 'discord.js';
import { db } from '#dbManager';
import { emoji } from '#emoji';
import { config } from '#config';
const { colors } = config;

import { disableComponents, logger } from '#utils';

class IgnoreCommand extends Command {
	constructor() {
		super({
			name: 'ignore',
			description: 'Manage ignored channels',
			usage: 'ignore',
			aliases: ['ignored', 'ignorechannel'],
			category: 'Configuration',
			cooldown: 180,
			examples: ['ignore', 'ignore add', 'ignore clear'],
			userPermissions: [PermissionFlagsBits.ManageGuild],
			permissions: [],
			enabledSlash: true,
			slashData: {
				name: 'ignore',
				description: 'Manage ignored channels',
				defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
			},
		});
	}

	async execute({ ctx }) {
		if (!ctx.guild) {
			return ctx.reply('This command is only available in servers');
		}

		const ignored = await db.guild.getIgnoredChannels(ctx.guild.id);
		const container = this._renderIgnoreEditor(ctx, ignored);

		await ctx.reply({
			components: [container],
			flags: MessageFlags.IsComponentsV2,
		});

		const message = await ctx.fetchReply();
		this._startCollector(ctx, message);
	}

	_renderIgnoreEditor(ctx, ignored, feedback = null) {
		const container = new ContainerBuilder();
		container.setAccentColor(colors.bot);

		const preview =
			ignored.length > 0
				? ignored
						.slice(0, 3)
						.map((id) => `<#${id}>`)
						.join(' • ') + (ignored.length > 3 ? ` +${ignored.length - 3} more` : '')
				: 'No channels ignored';

		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('## Ignored Channels'),
		);

		container.addSeparatorComponents(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
		);

		const feedbackText = feedback ? `\n\n${feedback}` : '';
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`${preview}${feedbackText}\n\n-# ${ignored.length} of 25 channels`,
			),
		);

		container.addSeparatorComponents(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
		);

		container.addActionRowComponents(
			new ActionRowBuilder().addComponents(
				new ChannelSelectMenuBuilder()
					.setCustomId('ignore|select')
					.setPlaceholder('Select channels to ignore')
					.setChannelTypes([ChannelType.GuildText])
					.setMinValues(0)
					.setMaxValues(25)
					.setDefaultChannels(ignored),
			),
		);

		container.addSeparatorComponents(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
		);

		container.addActionRowComponents(
			new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId('ignore|current')
					.setLabel('Add Current')
					.setStyle(ButtonStyle.Primary)
					.setDisabled(ignored.length >= 25),
				new ButtonBuilder()
					.setCustomId('ignore|category')
					.setLabel('Add Category')
					.setStyle(ButtonStyle.Primary)
					.setDisabled(ignored.length >= 25),
				new ButtonBuilder()
					.setCustomId('ignore|clear')
					.setLabel('Clear All')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(ignored.length === 0),
			),
		);

		return container;
	}

	_startCollector(ctx, message) {
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
				await this._handleAction(ctx, message, interaction);
			} catch (error) {
				logger.error('Ignore', 'Interaction error', error);
			}
		});

		collector.on('end', async () => {
			try {
				await disableComponents(message);
			} catch {}
		});
	}

	_canViewChannel(channel, botMember) {
		if (!channel || !botMember) return false;
		return channel.permissionsFor(botMember).has(PermissionFlagsBits.ViewChannel);
	}

	async _handleAction(ctx, msg, i) {
		const [action, param] = i.customId.split('|');
		const botMember = ctx.guild.members.me;

		if (action === 'ignore') {
			if (param === 'select') {
				const validChannels = i.values.filter((channelId) => {
					const channel = ctx.guild.channels.cache.get(channelId);
					return this._canViewChannel(channel, botMember);
				});

				const invalidCount = i.values.length - validChannels.length;

				if (invalidCount > 0) {
					await i.reply({
						content: `${emoji.cross} Cannot add ${invalidCount} channel${invalidCount > 1 ? 's' : ''} without view permission`,
						flags: MessageFlags.Ephemeral,
					});
				} else {
					await i.deferUpdate();
				}

				await db.guild.setIgnoredChannels(ctx.guild.id, validChannels);
				const updated = await db.guild.getIgnoredChannels(ctx.guild.id);

				await msg.edit({
					components: [this._renderIgnoreEditor(ctx, updated)],
				});
			} else if (param === 'current') {
				await i.deferUpdate();
				const current = await db.guild.getIgnoredChannels(ctx.guild.id);

				if (!this._canViewChannel(ctx.channel, botMember)) {
					await msg.edit({
						components: [
							this._renderIgnoreEditor(
								ctx,
								current,
								`${emoji.cross} Cannot ignore channel without view permission`,
							),
						],
					});

					setTimeout(async () => {
						try {
							const updated = await db.guild.getIgnoredChannels(ctx.guild.id);
							await msg.edit({
								components: [this._renderIgnoreEditor(ctx, updated)],
							});
						} catch (e) {
							logger.error('Ignore', 'Clear feedback error', e);
						}
					}, 2000);
					return;
				}

				if (current.includes(ctx.channel.id)) {
					await msg.edit({
						components: [
							this._renderIgnoreEditor(
								ctx,
								current,
								`${emoji.cross} Channel already in list`,
							),
						],
					});

					setTimeout(async () => {
						try {
							const updated = await db.guild.getIgnoredChannels(ctx.guild.id);
							await msg.edit({
								components: [this._renderIgnoreEditor(ctx, updated)],
							});
						} catch (e) {
							logger.error('Ignore', 'Clear feedback error', e);
						}
					}, 2000);
					return;
				}

				await db.guild.setIgnoredChannels(ctx.guild.id, [...current, ctx.channel.id]);

				const updated = await db.guild.getIgnoredChannels(ctx.guild.id);
				await msg.edit({
					components: [
						this._renderIgnoreEditor(
							ctx,
							updated,
							`${emoji.check} Current channel added`,
						),
					],
				});

				setTimeout(async () => {
					try {
						const finalUpdated = await db.guild.getIgnoredChannels(ctx.guild.id);
						await msg.edit({
							components: [this._renderIgnoreEditor(ctx, finalUpdated)],
						});
					} catch (e) {
						logger.error('Ignore', 'Clear feedback error', e);
					}
				}, 2000);
			} else if (param === 'category') {
				await i.deferUpdate();
				const channel = ctx.guild.channels.cache.get(ctx.channel.id);

				if (!channel?.parentId) {
					const current = await db.guild.getIgnoredChannels(ctx.guild.id);
					await msg.edit({
						components: [
							this._renderIgnoreEditor(
								ctx,
								current,
								`${emoji.cross} Channel not in a category`,
							),
						],
					});

					setTimeout(async () => {
						try {
							const updated = await db.guild.getIgnoredChannels(ctx.guild.id);
							await msg.edit({
								components: [this._renderIgnoreEditor(ctx, updated)],
							});
						} catch (e) {
							logger.error('Ignore', 'Clear feedback error', e);
						}
					}, 2000);
					return;
				}

				const categoryChannels = ctx.guild.channels.cache
					.filter(
						(c) =>
							c.parentId === channel.parentId &&
							c.type === ChannelType.GuildText &&
							this._canViewChannel(c, botMember),
					)
					.map((c) => c.id);

				const current = await db.guild.getIgnoredChannels(ctx.guild.id);
				const newChannels = categoryChannels.filter((id) => !current.includes(id));

				if (newChannels.length === 0) {
					await msg.edit({
						components: [
							this._renderIgnoreEditor(
								ctx,
								current,
								`${emoji.cross} No new channels to add from category`,
							),
						],
					});

					setTimeout(async () => {
						try {
							const updated = await db.guild.getIgnoredChannels(ctx.guild.id);
							await msg.edit({
								components: [this._renderIgnoreEditor(ctx, updated)],
							});
						} catch (e) {
							logger.error('Ignore', 'Clear feedback error', e);
						}
					}, 2000);
					return;
				}

				await db.guild.setIgnoredChannels(ctx.guild.id, [...current, ...newChannels]);

				const parent = ctx.guild.channels.cache.get(channel.parentId);
				const updated = await db.guild.getIgnoredChannels(ctx.guild.id);
				await msg.edit({
					components: [
						this._renderIgnoreEditor(
							ctx,
							updated,
							`${emoji.check} Added ${newChannels.length} from ${parent?.name || 'category'}`,
						),
					],
				});

				setTimeout(async () => {
					try {
						const finalUpdated = await db.guild.getIgnoredChannels(ctx.guild.id);
						await msg.edit({
							components: [this._renderIgnoreEditor(ctx, finalUpdated)],
						});
					} catch (e) {
						logger.error('Ignore', 'Clear feedback error', e);
					}
				}, 2000);
			} else if (param === 'clear') {
				await i.deferUpdate();
				await db.guild.setIgnoredChannels(ctx.guild.id, []);

				const updated = await db.guild.getIgnoredChannels(ctx.guild.id);
				await msg.edit({
					components: [
						this._renderIgnoreEditor(ctx, updated, `${emoji.check} All channels removed`),
					],
				});

				setTimeout(async () => {
					try {
						const finalUpdated = await db.guild.getIgnoredChannels(ctx.guild.id);
						await msg.edit({
							components: [this._renderIgnoreEditor(ctx, finalUpdated)],
						});
					} catch (e) {
						logger.error('Ignore', 'Clear feedback error', e);
					}
				}, 2000);
			}
		}
	}
}

export default new IgnoreCommand();
