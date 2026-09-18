import { REST } from "discord.js";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./logger.js";
import { commandBodies, putGlobalCommands, putGuildCommands } from "./commands/deploy.js";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const commands = commandBodies();

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

try {
  logger.info("Clearing global commands");
  await putGlobalCommands(rest, env.CLIENT_ID, []);
  if (env.DEV_GUILD_ID) {
    logger.info(
      { count: commands.length, guildId: env.DEV_GUILD_ID },
      "Deploying guild commands",
    );
    await putGuildCommands(rest, env.CLIENT_ID, env.DEV_GUILD_ID, commands);
  }
  logger.info("Command deploy complete");
} catch (error) {
  logger.error({ err: error }, "Command deploy failed");
  process.exit(1);
}
