import type { BotCommand } from "../types.js";
import { staffCommand } from "../shared.js";
import { startSendJoCommand } from "../../interactions/send-jo.js";
import { replyAppError } from "../../utils/reply.js";

export const sendJoCommand: BotCommand = {
  data: staffCommand(
    "send-jo",
    "Send a J.O. offer to the next READY person in line",
  ),
  async execute(interaction, ctx) {
    try {
      await startSendJoCommand(interaction, ctx);
    } catch (error) {
      await replyAppError(interaction, error, ctx.logger, ctx.db);
    }
  },
};
