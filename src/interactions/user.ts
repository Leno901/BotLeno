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
  updateJobHourPrefs,
} from "../services/queue.js";
import { parseDurationHours } from "../services/hours.js";
import { AppError, isAppError } from "../services/errors.js";
import { parseJoinModal, isUuid, joinJobBoundFieldId, Ids } from "./ids.js";
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
  joinHoursModal,
  leaveConfirmButtons,
  queueSelectRow,
  userQueueButtons,
} from "../ui/components.js";
import { ephemeral, replyAppError, safeReply, scheduleEphemeralDelete } from "../utils/reply.js";
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
            existing.entry.status === "active",
          ),
        ],
      }),
    );
    return;
  }

  setPendingJoin(guildId, interaction.user.id, queueIds);
  const selected = queueIds
    .map((id) => store.getQueue(ctx.db, id))
    .filter((queue): queue is NonNullable<typeof queue> => Boolean(queue));
  await interaction.showModal(joinHoursModal(selected));
}

function modalField(interaction: ModalSubmitInteraction, customId: string): string | null {
  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {
    return null;
  }
}

function parseJobHourPrefsFromModal(
  interaction: ModalSubmitInteraction,
  queueIds: string[],
): Record<string, { min: number | null; max: number | null }> {
  const jobHourPrefs: Record<string, { min: number | null; max: number | null }> = {};
  for (const queueId of queueIds) {
    const maxRaw = modalField(interaction, joinJobBoundFieldId(queueId, "max"));
    const minRaw = modalField(interaction, joinJobBoundFieldId(queueId, "min"));
    const maxHours = maxRaw == null ? { ok: true as const, hours: null } : parseDurationHours(maxRaw, 0.25);
    const minHours = minRaw == null ? { ok: true as const, hours: null } : parseDurationHours(minRaw, 0.25);
    if (!maxHours.ok) throw new AppError(maxHours.error, "INVALID_JOB_HOURS");
    if (!minHours.ok) throw new AppError(minHours.error, "INVALID_JOB_HOURS");
    if (
      minHours.hours != null &&
      maxHours.hours != null &&
      minHours.hours > maxHours.hours
    ) {
      throw new AppError("Min cannot be greater than Max.", "INVALID_JOB_HOURS");
    }
    jobHourPrefs[queueId] = { min: minHours.hours, max: maxHours.hours };
  }
  return jobHourPrefs;
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
    parsed === "pending" ? takePendingJoin(guildId, interaction.user.id) : [parsed];
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
  const hoursInput = modalField(interaction, "hours") ?? "";
  try {
    const parsedPrefs = parseJobHourPrefsFromModal(interaction, queueIds);
    const jobHourPrefs = Object.fromEntries(
      Object.entries(parsedPrefs).filter(([, pref]) => pref.min != null || pref.max != null),
    );
    const result = joinQueue(ctx.db, {
      guildId,
      queueIds,
      userId: interaction.user.id,
      hoursInput,
      jobHourPrefs,
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
    scheduleEphemeralDelete(interaction);
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
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  const view = getUserQueueStatus(ctx.db, guildId, interaction.user.id);
  if (!view) {
    await safeReply(
      interaction,
      ephemeral({ embeds: [infoEmbed("Stay in line", "You are still in the duty line.")] }),
    );
    scheduleEphemeralDelete(interaction);
    return;
  }
  await safeReply(
    interaction,
    ephemeral({
      embeds: [userStatusEmbed(view, timezone(ctx, guildId))],
      components: [
        userQueueButtons(
          view.queue.allowLeave,
          view.entry.status === "active",
        ),
      ],
    }),
  );
}

export async function handleJoinOpen(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  await showUserPanel(interaction, ctx);
}

export async function handleHours(
  interaction: ButtonInteraction,
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
  if (view.entry.status === "active") {
    await safeReply(
      interaction,
      ephemeral({ embeds: [warningEmbed("You cannot edit hours while on duty.")] }),
    );
    return;
  }
  await interaction.showModal(
    joinHoursModal(view.jobs, view.entry.jobHourPrefs, Ids.hoursModal),
  );
}

export async function handleHoursModal(
  interaction: ModalSubmitInteraction,
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
  try {
    const modalIds: string[] = [];
    let fields = 0;
    for (const job of view.jobs) {
      for (let i = 0; i < 2; i += 1) {
        if (fields >= 5) break;
        fields += 1;
        if (!modalIds.includes(job.id)) modalIds.push(job.id);
      }
      if (fields >= 5) break;
    }
    const parsed = parseJobHourPrefsFromModal(interaction, modalIds);
    const next = { ...view.entry.jobHourPrefs };
    for (const jobId of modalIds) {
      const pref = parsed[jobId];
      if (!pref || (pref.min == null && pref.max == null)) {
        delete next[jobId];
        continue;
      }
      next[jobId] = pref;
    }
    const updated = updateJobHourPrefs(ctx.db, {
      guildId,
      userId: interaction.user.id,
      jobHourPrefs: next,
    });
    ctx.display.schedule(guildId);
    logQueueActivity(ctx, guildId, {
      action: "hours",
      userId: interaction.user.id,
      actorId: interaction.user.id,
      detail: "updated job hours",
    });
    await safeReply(
      interaction,
      ephemeral({
        embeds: [userStatusEmbed(updated, timezone(ctx, guildId))],
        components: [
          userQueueButtons(
            updated.queue.allowLeave,
            updated.entry.status === "active",
          ),
        ],
      }),
    );
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
