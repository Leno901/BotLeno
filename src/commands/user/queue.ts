import type { BotCommand } from "../types.js";
import { guildOnlyCommand } from "../shared.js";
import { showUserPanel } from "../../interactions/user.js";
import { replyAppError } from "../../utils/reply.js";

export const queueCommand: BotCommand = {
  data: guildOnlyCommand("queue", "Open the BotLenoAPP queue panel"),
  async execute(interaction, ctx) {
    try {
      await showUserPanel(interaction, ctx);
    } catch (error) {
      await replyAppError(interaction, error, ctx.logger, ctx.db);
    }
  },
};
