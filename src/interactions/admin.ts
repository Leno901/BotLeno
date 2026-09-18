import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import type { AppContext } from "../app-context.js";
import * as store from "../database/store.js";
import {
  clearQueue,
  completeEntry,
  dispatchNext,
  listQueueBoard,
  listQueueMembers,
  moveEntry,
  removeEntry,
  setQueueStatus,
  skipEntry,
} from "../services/queue.js";
import { isUuid } from "./ids.js";
import { buttonCooldown, requireGuildId, staffMember } from "./guards.js";
import { getAdminSession, patchAdminSession } from "./session.js";
import {
  adminQueueEmbed,
  errorEmbed,
  historyEmbed,
  infoEmbed,
  successEmbed,
  warningEmbed,
} from "../ui/embeds.js";
import {
  adminEntryButtons,
  adminMemberSelect,
  adminQueueButtons,
  adminQueueSelect,
  confirmClearButtons,
} from "../ui/components.js";
import { ephemeral, replyAppError, safeReply } from "../utils/reply.js";
import { listHistory } from "../database/store.js";
import { logQueueActivity } from "../services/activity-log.js";
import { closeUserStatusChannel } from "../services/user-status-channel.js";

async function labeledMembers(
  interaction: { guild: { members: { fetch: (id: string) => Promise<{ displayName: string }> } } | null },
  entries: Array<{ id: string; userId: string; position: number }>,
) {
  const labeled = [];
  for (const entry of entries.slice(0, 25)) {
    let name = entry.userId;
    try {
      const member = await interaction.guild?.members.fetch(entry.userId);
      if (member) name = member.displayName;
    } catch {
      name = entry.userId;
    }
    labeled.push({ ...entry, name });
  }
  return labeled;
}

export async function showAdminPanel(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  staffMember(interaction, ctx);
  const queues = listQueueBoard(ctx.db, guildId);
  await safeReply(
    interaction,
    ephemeral({
      embeds: [
        infoEmbed(
          "🛠️ Queue Admin",
          "Select a queue to view waiting users, pause, skip, complete, or clear.",
        ),
      ],
      components: queues.length ? [adminQueueSelect(queues)] : [],
    }),
  );
}

export async function renderAdminQueue(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction,
  ctx: AppContext,
  queueId: string,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  staffMember(interaction, ctx);
  if (!isUuid(queueId)) {
    await safeReply(interaction, ephemeral({ embeds: [errorEmbed("Invalid queue.")] }));
    return;
  }

  const { queue, entries } = listQueueMembers(ctx.db, guildId, queueId);
  patchAdminSession(guildId, interaction.user.id, { queueId, entryId: undefined });

  const labeled = await labeledMembers(interaction, entries);
  const queues = listQueueBoard(ctx.db, guildId);

  const components = [
    adminQueueSelect(queues),
    adminQueueButtons(queue.status),
  ];
  if (labeled.length > 0) {
    components.splice(1, 0, adminMemberSelect(labeled));
    components.push(adminEntryButtons());
  }

  const payload = {
    embeds: [adminQueueEmbed(queue, entries)],
    components,
  };

  if (interaction.isMessageComponent() && (interaction.replied || interaction.deferred || interaction.message.flags)) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
      return;
    }
    await interaction.update(payload);
    return;
  }

  await safeReply(interaction, ephemeral(payload));
}

export async function handleAdminQueueSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  buttonCooldown(ctx, interaction.user.id);
  const queueId = interaction.values[0];
  if (!queueId) return;
  await renderAdminQueue(interaction, ctx, queueId);
}

export async function handleAdminEntrySelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  staffMember(interaction, ctx);
  buttonCooldown(ctx, interaction.user.id);
  const entryId = interaction.values[0];
  if (!entryId || !isUuid(entryId)) {
    await safeReply(interaction, ephemeral({ embeds: [errorEmbed("Invalid user selection.")] }));
    return;
  }
  const entry = store.getEntry(ctx.db, entryId);
  if (!entry || entry.guildId !== guildId) {
    await safeReply(interaction, ephemeral({ embeds: [warningEmbed("That user is no longer in the queue.")] }));
    return;
  }
  patchAdminSession(guildId, interaction.user.id, {
    queueId: entry.queueId,
    entryId: entry.id,
  });
  await interaction.reply(
    ephemeral({
      embeds: [
        infoEmbed(
          "User selected",
          `<@${entry.userId}> is selected. Use Skip, Complete, Remove, or Move.`,
        ),
      ],
    }),
  );
}

async function selectedEntry(
  interaction: ButtonInteraction,
  ctx: AppContext,
) {
  const guildId = requireGuildId(interaction);
  staffMember(interaction, ctx);
  const session = getAdminSession(guildId, interaction.user.id);
  if (!session.entryId) {
    throw new Error("SELECT_USER");
  }
  const entry = store.getEntry(ctx.db, session.entryId);
  if (!entry || entry.guildId !== guildId) {
    throw new Error("SELECT_USER");
  }
  return entry;
}

export async function handleAdminButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  staffMember(interaction, ctx);
  buttonCooldown(ctx, interaction.user.id);
  const session = getAdminSession(guildId, interaction.user.id);
  const id = interaction.customId;

  try {
    if (id === "admin:dispatch") {
      const view = dispatchNext(ctx.db, {
        guildId,
        actorId: interaction.user.id,
      });
      ctx.logger.info(
        { guildId, userId: view.entry.userId, entryId: view.entry.id },
        "Dispatched duty line",
      );
      ctx.display.schedule(guildId);
      logQueueActivity(ctx, guildId, {
        action: "dispatched",
        userId: view.entry.userId,
        actorId: interaction.user.id,
      });
      await safeReply(
        interaction,
        ephemeral({
          embeds: [
            successEmbed(
              "Dispatched",
              `<@${view.entry.userId}> is now **ON DUTY**.`,
            ),
          ],
        }),
      );
      return;
    }

    if (id === "admin:refresh") {
      if (!session.queueId) {
        await showAdminPanel(interaction, ctx);
        return;
      }
      await renderAdminQueue(interaction, ctx, session.queueId);
      return;
    }

    if (id === "admin:pause" || id === "admin:open" || id === "admin:close") {
      if (!session.queueId) {
        await safeReply(interaction, ephemeral({ embeds: [warningEmbed("Select a queue first.")] }));
        return;
      }
      const status = id === "admin:pause" ? "paused" : id === "admin:close" ? "closed" : "open";
      const queue = setQueueStatus(ctx.db, {
        guildId,
        queueId: session.queueId,
        status,
        actorId: interaction.user.id,
      });
      ctx.logger.info({ guildId, queueId: queue.id, status }, "Queue status changed");
      ctx.display.schedule(guildId);
      logQueueActivity(ctx, guildId, {
        action: status,
        actorId: interaction.user.id,
        detail: queue.name,
      });
      await renderAdminQueue(interaction, ctx, queue.id);
      return;
    }

    if (id === "admin:clear") {
      await safeReply(
        interaction,
        ephemeral({
          embeds: [
            warningEmbed(
              "Clear this queue?",
              "This removes every waiting user. This cannot be undone.",
            ),
          ],
          components: [confirmClearButtons()],
        }),
      );
      return;
    }

    if (id === "admin:clear:cancel") {
      await safeReply(
        interaction,
        ephemeral({ embeds: [infoEmbed("Clear cancelled", "The queue was not changed.")] }),
      );
      return;
    }

    if (id === "admin:clear:confirm") {
      if (!session.queueId) {
        await safeReply(interaction, ephemeral({ embeds: [warningEmbed("Select a queue first.")] }));
        return;
      }
      const result = clearQueue(ctx.db, {
        guildId,
        queueId: session.queueId,
        actorId: interaction.user.id,
      });
      if (interaction.guild) {
        for (const entry of result.entries) {
          await closeUserStatusChannel(ctx, interaction.guild, entry).catch(() => undefined);
        }
      }
      ctx.logger.info(
        { guildId, queueId: result.queue.id, cleared: result.cleared },
        "Queue cleared",
      );
      ctx.display.schedule(guildId);
      logQueueActivity(ctx, guildId, {
        action: "cleared",
        actorId: interaction.user.id,
        detail: `${result.queue.name} · ${result.cleared}`,
      });
      await safeReply(
        interaction,
        ephemeral({
          embeds: [
            successEmbed(
              "Queue cleared",
              `Removed ${result.cleared} waiting ${result.cleared === 1 ? "user" : "users"} from **${result.queue.name}**.`,
            ),
          ],
        }),
      );
      return;
    }

    const entry = await selectedEntry(interaction, ctx);

    if (id === "admin:skip") {
      skipEntry(ctx.db, {
        guildId,
        entryId: entry.id,
        actorId: interaction.user.id,
      });
      ctx.display.schedule(guildId);
      if (interaction.guild) {
        await closeUserStatusChannel(ctx, interaction.guild, entry).catch(() => undefined);
      }
      logQueueActivity(ctx, guildId, {
        action: "skipped",
        userId: entry.userId,
        actorId: interaction.user.id,
      });
      await renderAdminQueue(interaction, ctx, entry.queueId);
      return;
    }
    if (id === "admin:complete") {
      completeEntry(ctx.db, {
        guildId,
        entryId: entry.id,
        actorId: interaction.user.id,
      });
      ctx.display.schedule(guildId);
      if (interaction.guild) {
        await closeUserStatusChannel(ctx, interaction.guild, entry).catch(() => undefined);
      }
      logQueueActivity(ctx, guildId, {
        action: "completed",
        userId: entry.userId,
        actorId: interaction.user.id,
      });
      await renderAdminQueue(interaction, ctx, entry.queueId);
      return;
    }
    if (id === "admin:remove") {
      removeEntry(ctx.db, {
        guildId,
        entryId: entry.id,
        actorId: interaction.user.id,
      });
      ctx.display.schedule(guildId);
      if (interaction.guild) {
        await closeUserStatusChannel(ctx, interaction.guild, entry).catch(() => undefined);
      }
      logQueueActivity(ctx, guildId, {
        action: "removed",
        userId: entry.userId,
        actorId: interaction.user.id,
      });
      await renderAdminQueue(interaction, ctx, entry.queueId);
      return;
    }
    if (id === "admin:move-up" || id === "admin:move-down") {
      const { entries } = listQueueMembers(ctx.db, guildId, entry.queueId);
      const current = entries.find((item) => item.id === entry.id);
      if (!current) {
        await safeReply(interaction, ephemeral({ embeds: [warningEmbed("That user is no longer waiting.")] }));
        return;
      }
      const nextPosition =
        id === "admin:move-up" ? current.position - 1 : current.position + 1;
      moveEntry(ctx.db, {
        guildId,
        entryId: entry.id,
        newPosition: nextPosition,
        actorId: interaction.user.id,
      });
      ctx.display.schedule(guildId);
      logQueueActivity(ctx, guildId, {
        action: "moved",
        userId: entry.userId,
        actorId: interaction.user.id,
        detail: `#${nextPosition}`,
      });
      await renderAdminQueue(interaction, ctx, entry.queueId);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "SELECT_USER") {
      await safeReply(
        interaction,
        ephemeral({ embeds: [warningEmbed("Select a waiting user first.")] }),
      );
      return;
    }
    await replyAppError(interaction, error, ctx.logger, ctx.db);
  }
}

export async function showHistory(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = requireGuildId(interaction);
  staffMember(interaction, ctx);
  const rows = listHistory(ctx.db, guildId, 15);
  await safeReply(interaction, ephemeral({ embeds: [historyEmbed(rows)] }));
}
