import type { BotCommand } from "../types.js";
import { adminCommand } from "../shared.js";
import { runSetup } from "../../services/setup.js";
import { replyAppError } from "../../utils/reply.js";

export const setupCommand: BotCommand = {
  data: adminCommand("setup", "Create or repair BotLenoAPP channels, roles, and queue panel"),
  async execute(interaction, ctx) {
    try {
      await runSetup(interaction, ctx);
    } catch (error) {
      await replyAppError(interaction, error, ctx.logger, ctx.db);
    }
  },
};
