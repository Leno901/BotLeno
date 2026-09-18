import type { BotCommand } from "../types.js";
import { staffCommand } from "../shared.js";
import { staffMember } from "../../interactions/guards.js";
import { clearAllQueues } from "../../services/queue.js";
import { logQueueActivity } from "../../services/activity-log.js";
import { closeUserStatusChannel } from "../../services/user-status-channel.js";
import { errorEmbed, successEmbed } from "../../ui/embeds.js";
import { ephemeral, replyAppError, safeReply } from "../../utils/reply.js";

export const queueClearAllCommand: BotCommand = {
  data: staffCommand(
    "queue-clear-all",
    "Remove every waiting user from every queue",
  ),
  async execute(interaction, ctx) {
    try {
      if (!interaction.inCachedGuild()) {
        await safeReply(interaction, ephemeral({ embeds: [errorEmbed("Guild only")] }));
        return;
      }
      staffMember(interaction, ctx);
      const guildId = interaction.guildId;
      const result = clearAllQueues(ctx.db, {
        guildId,
        actorId: interaction.user.id,
      });
      if (interaction.guild) {
        for (const entry of result.entries) {
          await closeUserStatusChannel(ctx, interaction.guild, entry).catch(
            () => undefined,
          );
        }
      }
      ctx.display.schedule(guildId);
      logQueueActivity(ctx, guildId, {
        action: "cleared",
        actorId: interaction.user.id,
        detail: `all · ${result.cleared}`,
      });
      await safeReply(
        interaction,
        ephemeral({
          embeds: [
            successEmbed(
              "Queues cleared",
              `Removed ${result.cleared} waiting ${result.cleared === 1 ? "user" : "users"} from every queue.`,
            ),
          ],
        }),
      );
    } catch (error) {
      await replyAppError(interaction, error, ctx.logger, ctx.db);
    }
  },
};
