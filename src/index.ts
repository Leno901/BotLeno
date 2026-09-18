import { loadEnv } from "./config/env.js";
import { createLogger } from "./logger.js";
import { openDatabase } from "./database/client.js";
import { createBot } from "./bot.js";
import { startExpirationWorker } from "./services/expiration.js";
import { stopSendJoChains } from "./services/send-jo.js";
import { inviteUrl } from "./config/defaults.js";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);

logger.info("Bot started");

const db = openDatabase(env.DATABASE_PATH);
const { client, ctx } = createBot({ env, db, logger });
const stopExpiration = startExpirationWorker(ctx);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  stopExpiration();
  stopSendJoChains();
  ctx.display.stop();
  client.destroy();
  db.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("unhandledRejection", (error) => {
  logger.error({ err: error }, "Unhandled promise rejection");
});

await client.login(env.DISCORD_TOKEN);
logger.info({ invite: inviteUrl(env.CLIENT_ID) }, "Invite URL ready");
