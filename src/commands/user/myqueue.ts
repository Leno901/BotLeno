import type { BotCommand } from "../types.js";
import { guildOnlyCommand } from "../shared.js";
import { showMyStatus } from "../../interactions/user.js";
import { replyAppError } from "../../utils/reply.js";

export const myQueueCommand: BotCommand = {
  data: guildOnlyCommand("myqueue", "Show your current queue position and availability"),
  async execute(interaction, ctx) {
    try {
      await showMyStatus(interaction, ctx);
    } catch (error) {
      await replyAppError(interaction, error, ctx.logger, ctx.db);
    }
  },
};
