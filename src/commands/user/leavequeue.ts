import type { BotCommand } from "../types.js";
import { guildOnlyCommand } from "../shared.js";
import { handleLeavePrompt } from "../../interactions/user.js";
import { replyAppError } from "../../utils/reply.js";

export const leaveQueueCommand: BotCommand = {
  data: guildOnlyCommand("leavequeue", "Leave your current queue after confirmation"),
  async execute(interaction, ctx) {
    try {
      await handleLeavePrompt(interaction, ctx);
    } catch (error) {
      await replyAppError(interaction, error, ctx.logger, ctx.db);
    }
  },
};
