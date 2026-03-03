import { Command } from "#command";
import { MessageFlags } from "discord.js";

class PingCommand extends Command {
  constructor() {
    super({
      name: "ping",
      aliases: ["latency", "ms", "pong"],
      cooldown: 30,
      enabledSlash: true,
      slashData: {
        name: "ping",
        description: "Ping",
      },
    });
  }

  async execute({ ctx }) {
    const start = Date.now();

    await ctx.reply({
      content: "Pinging...",
      ...(ctx.interaction ? { flags: MessageFlags.Ephemeral } : {}),
    });

    const redisStart = Date.now();
    try {
      await ctx.client.c.ping();
    } catch {}

    const latency = Date.now() - start;
    const redisPing = Date.now() - redisStart;

    await ctx.editReply({
      content:
        `Latency: ${latency}ms\n` +
        `WebSocket: ${ctx.client.ws.ping}ms\n` +
        `Redis: ${redisPing}ms`,
    });
  }
}

export default new PingCommand();
