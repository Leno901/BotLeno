import {
  MessageFlags,
  type ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import type { AppContext } from "../app-context.js";
import { listQueueBoard } from "../services/queue.js";
import { parseOfferJobHours } from "../services/hours.js";
import { AppError } from "../services/errors.js";
import {
  isSendJoBusy,
  startSendJo,
  resolveSendJo,
  validateOfferText,
} from "../services/send-jo.js";
import { isUuid } from "./ids.js";
import { buttonCooldown, requireGuildId, staffMember } from "./guards.js";
import { setPendingSendJo, takePendingSendJo } from "./session.js";
import {
  errorEmbed,
  infoEmbed,
  successEmbed,
  warningEmbed,
} from "../ui/embeds.js";
import { sendJoModal, sendJoQueueSelect } from "../ui/components.js";
import { ephemeral, replaceEphemeralPrompt, replyAppError, safeReply, scheduleEphemeralDelete } from "../utils/reply.js";

export async function startSendJoCommand(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  staffMember(interaction, ctx);

  if (isSendJoBusy(guildId)) {
    await safeReply(
      interaction,
      ephemeral({
        embeds: [
          warningEmbed(
            "Offer in progress",
            "A J.O. offer is already in progress. Wait until it finishes.",
          ),
        ],
      }),
    );
    scheduleEphemeralDelete(interaction);
    return;
  }

  const queues = listQueueBoard(ctx.db, guildId);
  if (queues.length === 0) {
    await safeReply(
      interaction,
      ephemeral({
        embeds: [
          warningEmbed(
            "No J.O. categories",
            "No job orders are configured. Run `/setup` first.",
          ),
        ],
      }),
    );
    scheduleEphemeralDelete(interaction);
    return;
  }

  await safeReply(
    interaction,
    ephemeral({
      embeds: [
        infoEmbed(
          "Send J.O.",
          "Select one or more J.O. categories, then enter the offer and job hours.",
        ),
      ],
      components: [sendJoQueueSelect(queues)],
    }),
  );
}

export async function handleSendJoSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  staffMember(interaction, ctx);
  buttonCooldown(ctx, interaction.user.id);

  const queueIds = interaction.values.filter((value) => isUuid(value));
  if (queueIds.length === 0) {
    await safeReply(
      interaction,
      ephemeral({ embeds: [errorEmbed("Invalid J.O. category.")] }),
    );
    scheduleEphemeralDelete(interaction);
    return;
  }

  if (isSendJoBusy(guildId)) {
    await safeReply(
      interaction,
      ephemeral({
        embeds: [
          warningEmbed(
            "Offer in progress",
            "A J.O. offer is already in progress. Wait until it finishes.",
          ),
        ],
      }),
    );
    scheduleEphemeralDelete(interaction);
    return;
  }

  setPendingSendJo(guildId, interaction.user.id, queueIds);
  await interaction.showModal(sendJoModal());
}

export async function handleSendJoModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  staffMember(interaction, ctx);
  buttonCooldown(ctx, interaction.user.id);

  const queueIds = takePendingSendJo(guildId, interaction.user.id);
  if (!queueIds) {
    await replaceEphemeralPrompt(
      interaction,
      ephemeral({
        embeds: [
          warningEmbed(
            "Selection expired",
            "Select J.O. categories again, then enter the offer message.",
          ),
        ],
      }),
    );
    scheduleEphemeralDelete(interaction);
    return;
  }

  try {
    const offerText = validateOfferText(
      interaction.fields.getTextInputValue("offer"),
    );
    const hours = parseOfferJobHours(interaction.fields.getTextInputValue("jobHours"));
    if (!hours.ok) {
      throw new AppError(hours.error, "INVALID_JOB_HOURS");
    }
    const started = await startSendJo(ctx, {
      guildId,
      queueIds,
      offerText,
      jobHours: hours.hours!,
      staffId: interaction.user.id,
    });
    await replaceEphemeralPrompt(
      interaction,
      ephemeral({
        embeds: [
          successEmbed(
            "Sending J.O.",
            `Offering **${started.queueName}** down the duty line.`,
          ),
        ],
      }),
    );
    scheduleEphemeralDelete(interaction);
  } catch (error) {
    await replyAppError(interaction, error, ctx.logger, ctx.db);
    if (interaction.message) {
      await interaction.message.delete().catch(() => undefined);
    }
    scheduleEphemeralDelete(interaction);
  }
}

export async function handleSendJoButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  parsed: { accepted: boolean; token: string },
): Promise<void> {
  buttonCooldown(ctx, interaction.user.id);
  try {
    if (!interaction.message.flags.has(MessageFlags.Ephemeral)) {
      await interaction.deferUpdate();
    }
    const result = await resolveSendJo(
      ctx,
      parsed.token,
      interaction.user.id,
      parsed.accepted,
    );
    if (!interaction.message.flags.has(MessageFlags.Ephemeral)) {
      return;
    }
    await safeReply(
      interaction,
      ephemeral({
        embeds: [
          result === "accepted"
            ? successEmbed("Accepted", "You accepted the J.O. You are now **ON DUTY**.")
            : infoEmbed("Declined", "You declined this J.O. offer."),
        ],
      }),
    );
  } catch (error) {
    await replyAppError(interaction, error, ctx.logger, ctx.db);
  }
}
