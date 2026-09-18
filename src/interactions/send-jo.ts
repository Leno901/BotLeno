import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import type { AppContext } from "../app-context.js";
import { listQueueBoard } from "../services/queue.js";
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
import { ephemeral, replyAppError, safeReply } from "../utils/reply.js";

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
    return;
  }

  await safeReply(
    interaction,
    ephemeral({
      embeds: [
        infoEmbed(
          "Send J.O.",
          "Select a J.O. category, then enter the offer message.",
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

  const queueId = interaction.values[0];
  if (!queueId || !isUuid(queueId)) {
    await safeReply(
      interaction,
      ephemeral({ embeds: [errorEmbed("Invalid J.O. category.")] }),
    );
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
    return;
  }

  setPendingSendJo(guildId, interaction.user.id, queueId);
  await interaction.showModal(sendJoModal());
}

export async function handleSendJoModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  staffMember(interaction, ctx);
  buttonCooldown(ctx, interaction.user.id);

  const queueId = takePendingSendJo(guildId, interaction.user.id);
  if (!queueId) {
    await safeReply(
      interaction,
      ephemeral({
        embeds: [
          warningEmbed(
            "Selection expired",
            "Select a J.O. category again, then enter the offer message.",
          ),
        ],
      }),
    );
    return;
  }

  try {
    const offerText = validateOfferText(
      interaction.fields.getTextInputValue("offer"),
    );
    const started = await startSendJo(ctx, {
      guildId,
      queueId,
      offerText,
      staffId: interaction.user.id,
    });
    await safeReply(
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
  } catch (error) {
    await replyAppError(interaction, error, ctx.logger, ctx.db);
  }
}

export async function handleSendJoButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  parsed: { accepted: boolean; token: string },
): Promise<void> {
  buttonCooldown(ctx, interaction.user.id);
  try {
    const result = await resolveSendJo(
      ctx,
      parsed.token,
      interaction.user.id,
      parsed.accepted,
    );
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
