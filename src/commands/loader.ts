import { Collection } from "discord.js";
import type { BotCommand } from "./types.js";
import { setupCommand } from "./admin/setup.js";
import { queueConfigCommand } from "./admin/queue-config.js";
import { queueAdminCommand } from "./staff/queue-admin.js";
import { queueClearAllCommand } from "./staff/queue-clear-all.js";
import { sendJoCommand } from "./staff/send-jo.js";
import { queueCommand } from "./user/queue.js";
import { myQueueCommand } from "./user/myqueue.js";
import { leaveQueueCommand } from "./user/leavequeue.js";

export function loadCommands(): Collection<string, BotCommand> {
  const commands = new Collection<string, BotCommand>();
  for (const command of [
    setupCommand,
    queueConfigCommand,
    queueAdminCommand,
    queueClearAllCommand,
    sendJoCommand,
    queueCommand,
    myQueueCommand,
    leaveQueueCommand,
  ]) {
    commands.set(command.data.name, command);
  }
  return commands;
}
