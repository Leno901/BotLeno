import { EXPIRATION_INTERVAL_MS } from "../config/defaults.js";
import type { AppContext } from "../app-context.js";
import * as store from "../database/store.js";
import { expireDue } from "./queue.js";
import { expiredEmbed } from "../ui/embeds.js";
import { logQueueActivity } from "./activity-log.js";
import { closeUserStatusChannel } from "./user-status-channel.js";

export function startExpirationWorker(ctx: AppContext): () => void {
  const tick = async () => {
    try {
      const expired = expireDue(ctx.db, new Date());
      if (expired.length === 0) return;

      ctx.logger.info({ count: expired.length }, "Queue entries expired");
      const guildIds = new Set(expired.map((entry) => entry.guildId));
      for (const guildId of guildIds) ctx.display.schedule(guildId);

      for (const entry of expired) {
        const queue = store.getQueue(ctx.db, entry.queueId);
        logQueueActivity(ctx, entry.guildId, {
          action: "expired",
          userId: entry.userId,
          actorId: "system",
          detail: queue?.name,
        });
        const guild = ctx.client.guilds.cache.get(entry.guildId);
        if (guild) {
          await closeUserStatusChannel(ctx, guild, entry).catch(() => undefined);
        }
        try {
          const user = await ctx.client.users.fetch(entry.userId);
          await user.send({
            embeds: [expiredEmbed(queue?.name ?? "queue")],
          });
        } catch {
          ctx.logger.debug(
            { userId: entry.userId, guildId: entry.guildId },
            "Could not DM expired queue user",
          );
        }
      }
    } catch (error) {
      ctx.logger.error({ err: error }, "Expiration worker failed");
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, EXPIRATION_INTERVAL_MS);

  return () => clearInterval(timer);
}
