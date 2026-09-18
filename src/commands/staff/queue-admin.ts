import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import type { BotCommand } from "../types.js";
import { autocompleteQueue } from "../shared.js";
import * as store from "../../database/store.js";
import {
  clearQueue,
  completeEntry,
  moveEntry,
  removeEntry,
  setQueueStatus,
  skipEntry,
} from "../../services/queue.js";
import { staffMember } from "../../interactions/guards.js";
import { isUuid } from "../../interactions/ids.js";
import { showAdminPanel, showHistory } from "../../interactions/admin.js";
import { errorEmbed, successEmbed, warningEmbed } from "../../ui/embeds.js";
import { ephemeral, replyAppError, safeReply } from "../../utils/reply.js";
import { logQueueActivity } from "../../services/activity-log.js";
import { closeUserStatusChannel } from "../../services/user-status-channel.js";

function withUser(name: string, description: string) {
  return (sub: SlashCommandSubcommandBuilder) =>
    sub
      .setName(name)
      .setDescription(description)
      .addUserOption((option) =>
        option.setName("user").setDescription("Target user").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("queue").setDescription("Queue").setAutocomplete(true),
      );
}

function withQueue(name: string, description: string) {
  return (sub: SlashCommandSubcommandBuilder) =>
    sub
      .setName(name)
      .setDescription(description)
      .addStringOption((option) =>
        option
          .setName("queue")
          .setDescription("Queue")
          .setRequired(true)
          .setAutocomplete(true),
      );
}

export const queueAdminCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("queue-admin")
    .setDescription("Staff controls for BotLenoAPP queues")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub.setName("panel").setDescription("Open the staff queue panel"),
    )
    .addSubcommand((sub) =>
      sub.setName("history").setDescription("Show recent queue history"),
    )
    .addSubcommand(withUser("skip", "Skip a waiting user"))
    .addSubcommand(withUser("remove", "Remove a waiting user"))
    .addSubcommand(withUser("complete", "Mark a user's job complete"))
    .addSubcommand(withQueue("pause", "Pause a queue so nobody can join"))
    .addSubcommand(withQueue("resume", "Resume a paused queue"))
    .addSubcommand(withQueue("close", "Close a queue"))
    .addSubcommand(withQueue("open", "Open a queue"))
    .addSubcommand(withQueue("clear", "Remove every waiting user from a queue"))
    .addSubcommand((sub) =>
      sub
        .setName("move")
        .setDescription("Move a waiting user to a new position")
        .addUserOption((option) =>
          option.setName("user").setDescription("User to move").setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("position")
            .setDescription("New position starting at 1")
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((option) =>
          option.setName("queue").setDescription("Queue").setAutocomplete(true),
        ),
    ),
  async autocomplete(interaction, ctx) {
    await autocompleteQueue(interaction, ctx);
  },
  async execute(interaction, ctx) {
    try {
      if (!interaction.inCachedGuild()) {
        await safeReply(interaction, ephemeral({ embeds: [errorEmbed("Guild only")] }));
        return;
      }
      staffMember(interaction, ctx);
      const guildId = interaction.guildId;
      const sub = interaction.options.getSubcommand();

      if (sub === "panel") {
        await showAdminPanel(interaction, ctx);
        return;
      }
      if (sub === "history") {
        await showHistory(interaction, ctx);
        return;
      }

      if (["pause", "resume", "close", "open", "clear"].includes(sub)) {
        const queueId = interaction.options.getString("queue", true);
        const queue = isUuid(queueId) ? store.getQueue(ctx.db, queueId) : null;
        if (!queue || queue.guildId !== guildId) {
          await safeReply(interaction, ephemeral({ embeds: [errorEmbed("Invalid queue.")] }));
          return;
        }
        if (sub === "clear") {
          const result = clearQueue(ctx.db, {
            guildId,
            queueId,
            actorId: interaction.user.id,
          });
          if (interaction.guild) {
            for (const entry of result.entries) {
              await closeUserStatusChannel(ctx, interaction.guild, entry).catch(
                () => undefined,
              );
            }
          }
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
                  `Removed ${result.cleared} waiting users from **${result.queue.name}**.`,
                ),
              ],
            }),
          );
          return;
        }
        const status =
          sub === "pause" ? "paused" : sub === "close" ? "closed" : "open";
        setQueueStatus(ctx.db, {
          guildId,
          queueId,
          status,
          actorId: interaction.user.id,
        });
        ctx.display.schedule(guildId);
        logQueueActivity(ctx, guildId, {
          action: status,
          actorId: interaction.user.id,
          detail: queue.name,
        });
        await safeReply(
          interaction,
          ephemeral({
            embeds: [successEmbed("Queue updated", `**${queue.name}** is now ${status}.`)],
          }),
        );
        return;
      }

      const user = interaction.options.getUser("user", true);
      const queueOption = interaction.options.getString("queue");
      const entry =
        queueOption && isUuid(queueOption)
          ? store.getActiveEntry(ctx.db, queueOption, user.id)
          : (store.listActiveEntriesForUser(ctx.db, guildId, user.id)[0] ?? null);

      if (!entry || entry.guildId !== guildId) {
        await safeReply(
          interaction,
          ephemeral({
            embeds: [warningEmbed("Not queued", `${user} is not waiting in that queue.`)],
          }),
        );
        return;
      }

      if (sub === "skip") {
        skipEntry(ctx.db, { guildId, entryId: entry.id, actorId: interaction.user.id });
      } else if (sub === "remove") {
        removeEntry(ctx.db, { guildId, entryId: entry.id, actorId: interaction.user.id });
      } else if (sub === "complete") {
        completeEntry(ctx.db, { guildId, entryId: entry.id, actorId: interaction.user.id });
      } else if (sub === "move") {
        moveEntry(ctx.db, {
          guildId,
          entryId: entry.id,
          newPosition: interaction.options.getInteger("position", true),
          actorId: interaction.user.id,
        });
      }

      ctx.display.schedule(guildId);
      if (
        interaction.guild &&
        (sub === "skip" || sub === "remove" || sub === "complete")
      ) {
        await closeUserStatusChannel(ctx, interaction.guild, entry).catch(
          () => undefined,
        );
      }
      const movedTo =
        sub === "move"
          ? `#${String(interaction.options.getInteger("position", true)).padStart(2, "0")}`
          : undefined;
      logQueueActivity(ctx, guildId, {
        action: sub === "move" ? "moved" : sub,
        userId: user.id,
        actorId: interaction.user.id,
        detail: movedTo,
      });
      await safeReply(
        interaction,
        ephemeral({
          embeds: [successEmbed("Updated", `Updated ${user} in the queue.`)],
        }),
      );
    } catch (error) {
      await replyAppError(interaction, error, ctx.logger, ctx.db);
    }
  },
};
