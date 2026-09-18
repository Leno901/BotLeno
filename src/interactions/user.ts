import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import type { AppContext } from "../app-context.js";
import * as store from "../database/store.js";
import {
  getUserQueueStatus,
  joinQueue,
  leaveQueue,
  listQueueBoard,
  toggleAfk,
} from "../services/queue.js";
import { isAppError } from "../services/errors.js";
import { parseJoinModal, isUuid } from "./ids.js";
import { setPendingJoin, takePendingJoin } from "./session.js";
import { buttonCooldown, joinCooldown, requireGuildId } from "./guards.js";
import {
  alreadyQueuedEmbed,
  errorEmbed,
  infoEmbed,
  joinedEmbed,
  queuePanelEmbed,
  userStatusEmbed,
  warningEmbed,
  pickDiscordDisplayName,
} from "../ui/embeds.js";
import {
  hoursModal,
  leaveConfirmButtons,
  queueSelectRow,
  userQueueButtons,
} from "../ui/components.js";
import { ephemeral, replyAppError, safeReply } from "../utils/reply.js";
import type { ModalSubmitInteraction } from "discord.js";
import { logQueueActivity } from "../services/activity-log.js";
import {
  closeUserStatusChannel,
  openUserStatusChannel,
} from "../services/user-status-channel.js";

function timezone(ctx: AppContext, guildId: string): string {
  return store.ensureGuild(ctx.db, guildId, ctx.env.DEFAULT_TIMEZONE).timezone;
}

export async function showUserPanel(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  const queues = listQueueBoard(ctx.db, guildId);
  await safeReply(
    interaction,
    ephemeral({
      embeds: [queuePanelEmbed(queues)],
      components: queues.length ? [queueSelectRow(queues)] : [],
    }),
  );
}

export async function showMyStatus(
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  buttonCooldown(ctx, interaction.user.id);
  const view = getUserQueueStatus(ctx.db, guildId, interaction.user.id);
  if (!view) {
    await safeReply(
      interaction,
      ephemeral({
        embeds: [
          infoEmbed(
            "🎯 Your Queue Status",
            "You are not in the duty line. Join from #queue-start.",
          ),
        ],
        components: [],
      }),
    );
    return;
  }

  await safeReply(
    interaction,
    ephemeral({
      embeds: [userStatusEmbed(view, timezone(ctx, guildId))],
      components: [
        userQueueButtons(
          view.queue.allowLeave,
          view.entry.isAfk,
          view.entry.status === "active",
        ),
      ],
    }),
  );
}

export async function handleQueueSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  buttonCooldown(ctx, interaction.user.id);
  const queueIds = interaction.values.filter((value) => isUuid(value));
  if (queueIds.length === 0) {
    await safeReply(
      interaction,
      ephemeral({ embeds: [errorEmbed("Select at least one J.O.")] }),
    );
    return;
  }

  for (const queueId of queueIds) {
    const queue = store.getQueue(ctx.db, queueId);
    if (!queue || queue.guildId !== guildId) {
      await safeReply(
        interaction,
        ephemeral({ embeds: [warningEmbed("That J.O. is no longer available.")] }),
      );
      return;
    }
  }

  const existing = getUserQueueStatus(ctx.db, guildId, interaction.user.id);
  if (existing) {
    await safeReply(
      interaction,
      ephemeral({
        embeds: [alreadyQueuedEmbed(existing)],
        components: [
          userQueueButtons(
            existing.queue.allowLeave,
            existing.entry.isAfk,
            existing.entry.status === "active",
          ),
        ],
      }),
    );
    return;
  }

  setPendingJoin(guildId, interaction.user.id, queueIds);
  await interaction.showModal(hoursModal());
}

export async function handleJoinModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  const parsed = parseJoinModal(interaction.customId);
  if (!parsed) {
    await safeReply(
      interaction,
      ephemeral({ embeds: [errorEmbed("Invalid join request.")] }),
    );
    return;
  }

  const queueIds =
    parsed === "pending"
      ? takePendingJoin(guildId, interaction.user.id)
      : [parsed];
  if (!queueIds || queueIds.length === 0) {
    await safeReply(
      interaction,
      ephemeral({
        embeds: [
          warningEmbed(
            "Selection expired",
            "Select your J.O.s again, then join.",
          ),
        ],
      }),
    );
    return;
  }

  joinCooldown(ctx, interaction.user.id);
  const hoursInput = interaction.fields.getTextInputValue("hours");

  try {
    const result = joinQueue(ctx.db, {
      guildId,
      queueIds,
      userId: interaction.user.id,
      hoursInput,
    });
    ctx.logger.info(
      {
        guildId,
        jobs: result.jobs.map((job) => job.slug),
        userId: interaction.user.id,
        position: result.position,
      },
      "User joined duty line",
    );
    ctx.display.schedule(guildId);
    logQueueActivity(ctx, guildId, {
      action: "joined",
      userId: interaction.user.id,
      actorId: interaction.user.id,
      detail: `${result.jobs.map((job) => job.name).join(", ")} · #${result.position}`,
    });
    let statusChannelId: string | null = null;
    if (interaction.guild) {
      try {
        const member = interaction.member;
        const channel = await openUserStatusChannel(
          ctx,
          interaction.guild,
          result.entry,
          pickDiscordDisplayName({
            displayName:
              member && "displayName" in member ? member.displayName : null,
            nickname: member && "nickname" in member ? member.nickname : null,
            globalName: interaction.user.globalName,
            username: interaction.user.username,
            userId: interaction.user.id,
          }),
        );
        statusChannelId = channel?.id ?? null;
      } catch (error) {
        ctx.logger.warn(
          { err: error, guildId, userId: interaction.user.id },
          "Failed to open personal queue status",
        );
      }
    }
    const queues = listQueueBoard(ctx.db, guildId);
    await safeReply(
      interaction,
      ephemeral({
        embeds: [
          joinedEmbed(
            result,
            timezone(ctx, guildId),
            queues.length,
            statusChannelId,
          ),
        ],
        components: [
          userQueueButtons(
            result.jobs.every((job) => job.allowLeave),
            result.entry.isAfk,
            result.entry.status === "active",
          ),
        ],
      }),
    );
  } catch (error) {
    await replyAppError(interaction, error, ctx.logger, ctx.db);
  }
}

export async function handleLeavePrompt(
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  buttonCooldown(ctx, interaction.user.id);
  const view = getUserQueueStatus(ctx.db, guildId, interaction.user.id);
  if (!view) {
    await safeReply(
      interaction,
        ephemeral({ embeds: [warningEmbed("You are not in the duty line.")] }),
    );
    return;
  }

  await safeReply(
    interaction,
    ephemeral({
      embeds: [
        warningEmbed(
          "Leave the duty line?",
          "Are you sure you want to leave the duty line?",
        ),
      ],
      components: [leaveConfirmButtons()],
    }),
  );
}

export async function handleLeaveConfirm(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  buttonCooldown(ctx, interaction.user.id);
  try {
    const view = leaveQueue(ctx.db, {
      guildId,
      userId: interaction.user.id,
    });
    ctx.logger.info(
      { guildId, queueId: view.queue.id, userId: interaction.user.id },
      "User left queue",
    );
    ctx.display.schedule(guildId);
    logQueueActivity(ctx, guildId, {
      action: "left",
      userId: interaction.user.id,
      actorId: interaction.user.id,
    });
    await safeReply(
      interaction,
      ephemeral({
        embeds: [
          infoEmbed(
            "Left the duty line",
            "You left the duty line.",
          ),
        ],
        components: [],
      }),
    );
    if (interaction.guild) {
      await closeUserStatusChannel(ctx, interaction.guild, view.entry).catch(
        () => undefined,
      );
    }
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_IN_QUEUE") {
      await safeReply(
        interaction,
        ephemeral({ embeds: [warningEmbed("You are not in the duty line.")] }),
      );
      return;
    }
    await replyAppError(interaction, error, ctx.logger, ctx.db);
  }
}

export async function handleLeaveCancel(
  interaction: ButtonInteraction,
): Promise<void> {
  await safeReply(
    interaction,
    ephemeral({ embeds: [infoEmbed("Stay in line", "You are still in the duty line.")] }),
  );
}

export async function handleJoinOpen(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  await showUserPanel(interaction, ctx);
}

export async function handleAfk(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  buttonCooldown(ctx, interaction.user.id);
  try {
    const view = toggleAfk(ctx.db, {
      guildId,
      userId: interaction.user.id,
    });
    ctx.display.schedule(guildId);
    logQueueActivity(ctx, guildId, {
      action: view.entry.isAfk ? "AFK" : "ready",
      userId: interaction.user.id,
      actorId: interaction.user.id,
    });
    const embeds = [userStatusEmbed(view, timezone(ctx, guildId))];
    const components = [
      userQueueButtons(
        view.queue.allowLeave,
        view.entry.isAfk,
        view.entry.status === "active",
      ),
    ];
    if (interaction.replied || interaction.deferred) {
      await safeReply(interaction, ephemeral({ embeds, components }));
      return;
    }
    await interaction.update({ embeds, components });
  } catch (error) {
    await replyAppError(interaction, error, ctx.logger, ctx.db);
  }
}

export async function handleLineup(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  buttonCooldown(ctx, interaction.user.id);
  ctx.display.schedule(guildId);
  await showMyStatus(interaction, ctx);
}
