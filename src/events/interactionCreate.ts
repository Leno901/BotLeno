import { Events, type Client, type Collection } from "discord.js";
import type { AppContext } from "../app-context.js";
import type { BotCommand } from "../commands/types.js";
import { handleButton, handleModal, handleSelect } from "../interactions/router.js";
import { errorEmbed } from "../ui/embeds.js";
import { ephemeral, isUnknownInteraction, safeReply } from "../utils/reply.js";

export function registerInteractions(
  client: Client,
  ctx: AppContext,
  commands: Collection<string, BotCommand>,
): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        const command = commands.get(interaction.commandName);
        if (!command?.autocomplete) {
          await interaction.respond([]);
          return;
        }
        await command.autocomplete(interaction, ctx);
        return;
      }

      if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (!command) {
          await safeReply(
            interaction,
            ephemeral({ embeds: [errorEmbed("Unknown command")] }),
          );
          return;
        }
        await command.execute(interaction, ctx);
        return;
      }

      if (interaction.isButton()) {
        await handleButton(interaction, ctx);
        return;
      }

      if (interaction.isStringSelectMenu()) {
        await handleSelect(interaction, ctx);
        return;
      }

      if (interaction.isModalSubmit()) {
        await handleModal(interaction, ctx);
      }
    } catch (error) {
      if (isUnknownInteraction(error)) return;
      ctx.logger.error({ err: error }, "Interaction handler failed");
      if (interaction.isRepliable()) {
        await safeReply(
          interaction,
          ephemeral({
            embeds: [
              errorEmbed(
                "Something went wrong",
                "Please try again. If this keeps happening, ask staff to check the bot logs.",
              ),
            ],
          }),
        ).catch(() => undefined);
      }
    }
  });
}
