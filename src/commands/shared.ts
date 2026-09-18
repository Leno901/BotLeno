import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
} from "discord.js";
import type { AppContext } from "../app-context.js";
import * as store from "../database/store.js";
import { requireGuildId } from "../interactions/guards.js";

export async function autocompleteQueue(
  interaction: AutocompleteInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.respond([]);
    return;
  }
  store.ensureGuild(ctx.db, guildId, ctx.env.DEFAULT_TIMEZONE);
  const focused = interaction.options.getFocused().toLowerCase();
  const queues = store.listQueues(ctx.db, guildId);
  await interaction.respond(
    queues
      .filter(
        (queue) =>
          queue.name.toLowerCase().includes(focused) ||
          queue.slug.toLowerCase().includes(focused),
      )
      .slice(0, 25)
      .map((queue) => ({
        name: `${queue.emoji} ${queue.name}`,
        value: queue.id,
      })),
  );
}

export function guildOnlyCommand(name: string, description: string) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDMPermission(false);
}

export function adminCommand(name: string, description: string) {
  return guildOnlyCommand(name, description).setDefaultMemberPermissions(
    PermissionFlagsBits.ManageGuild,
  );
}

export const staffCommand = adminCommand;

export { requireGuildId };
