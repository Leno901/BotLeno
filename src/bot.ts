import {
  Client,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import type { Env } from "./config/env.js";
import type { Db } from "./database/client.js";
import type { Logger } from "./logger.js";
import { createCooldownTracker } from "./services/cooldown.js";
import { createDisplaySync, type AppContext } from "./app-context.js";
import { refreshGuildDisplays } from "./services/display.js";
import { loadCommands } from "./commands/loader.js";
import { registerReady } from "./events/ready.js";
import { registerInteractions } from "./events/interactionCreate.js";

export function createBot(options: {
  env: Env;
  db: Db;
  logger: Logger;
}): { client: Client; ctx: AppContext; commands: ReturnType<typeof loadCommands> } {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    partials: [Partials.Channel],
  });

  const commands = loadCommands();
  const ctx: AppContext = {
    db: options.db,
    env: options.env,
    logger: options.logger,
    cooldown: createCooldownTracker(),
    client,
    display: createDisplaySync(async (guildId) => {
      await refreshGuildDisplays(ctx, guildId);
    }),
  };

  registerReady(client, ctx);
  registerInteractions(client, ctx, commands);

  client.on("error", (error) => {
    options.logger.error({ err: error }, "Discord client error");
  });

  return { client, ctx, commands };
}
