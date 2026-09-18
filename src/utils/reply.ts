import {
  MessageFlags,
  type Interaction,
  type InteractionReplyOptions,
  type MessageComponentInteraction,
} from "discord.js";
import { isUnknownInteraction } from "../app-context.js";
import { EPHEMERAL_AUTO_DELETE_MS } from "../config/defaults.js";
import type { Logger } from "../logger.js";
import { isAppError } from "../services/errors.js";
import { errorEmbed, warningEmbed } from "../ui/embeds.js";

export { isUnknownInteraction };

export function ephemeral(
  options: InteractionReplyOptions,
): InteractionReplyOptions {
  return { ...options, flags: MessageFlags.Ephemeral };
}

export function canUpdateEphemeral(interaction: Interaction): boolean {
  return (
    interaction.isMessageComponent() &&
    !interaction.replied &&
    !interaction.deferred &&
    interaction.message.flags.has(MessageFlags.Ephemeral)
  );
}

export function scheduleEphemeralDelete(
  interaction: Interaction,
  delayMs = EPHEMERAL_AUTO_DELETE_MS,
): void {
  if (!interaction.isRepliable()) return;
  setTimeout(() => {
    void interaction.deleteReply().catch(() => undefined);
  }, delayMs);
}

export async function safeReply(
  interaction: Interaction,
  options: InteractionReplyOptions,
): Promise<void> {
  if (!interaction.isRepliable()) return;
  try {
    if (canUpdateEphemeral(interaction)) {
      const component = interaction as MessageComponentInteraction;
      await component.update({
        content: options.content ?? null,
        embeds: options.embeds ?? [],
        components: options.components ?? [],
      });
      return;
    }
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(options);
      return;
    }
    await interaction.reply(options);
  } catch (error) {
    if (!isUnknownInteraction(error)) throw error;
  }
}

/** Reply, then drop the earlier ephemeral prompt (e.g. /send-jo select). */
export async function replaceEphemeralPrompt(
  interaction: Interaction,
  options: InteractionReplyOptions,
): Promise<void> {
  await safeReply(interaction, options);
  if (interaction.isModalSubmit() && interaction.message) {
    await interaction.message.delete().catch(() => undefined);
  }
}

export async function replyAppError(
  interaction: Interaction,
  error: unknown,
  logger: Logger,
  _db?: unknown,
): Promise<void> {
  if (!isAppError(error)) {
    logger.error({ err: error }, "Unhandled interaction error");
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
    );
    return;
  }

  const title =
    error.code === "ALREADY_QUEUED"
      ? "⚠️ Already Queued"
      : error.code === "QUEUE_PAUSED"
        ? "⚠️ Queue Paused"
        : error.code === "QUEUE_CLOSED"
          ? "⚠️ Queue Closed"
          : error.kind === "error"
            ? "❌ Error"
            : "⚠️ Notice";

  const embed =
    error.kind === "error" && !error.code.startsWith("QUEUE") && error.code !== "ALREADY_QUEUED"
      ? errorEmbed(title, error.message)
      : warningEmbed(title, error.message);

  await safeReply(interaction, ephemeral({ embeds: [embed] }));
}

export function friendlyDiscordError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code);
    switch (code) {
      case "50013":
        return "Missing Permissions";
      case "50001":
        return "Missing Access";
      case "10003":
        return "Unknown Channel";
      case "10008":
        return "Unknown Message";
      case "10011":
        return "Unknown Role";
      case "10062":
        return "Unknown Interaction";
      case "50035":
        return "Invalid Form Body";
      default:
        break;
    }
  }
  return "Discord request failed";
}
