import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { BotCommand } from "../types.js";
import { autocompleteQueue } from "../shared.js";
import * as store from "../../database/store.js";
import { isValidTimeZone } from "../../services/time.js";
import { requireManageGuild } from "../../interactions/guards.js";
import { updateGuildSettings } from "../../services/queue.js";
import { ABSOLUTE_MAX_HOURS } from "../../config/defaults.js";
import {
  errorEmbed,
  infoEmbed,
  successEmbed,
} from "../../ui/embeds.js";
import { ephemeral, replyAppError, safeReply } from "../../utils/reply.js";
import { isUuid } from "../../interactions/ids.js";

export const queueConfigCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("queue-config")
    .setDescription("Configure BotLenoAPP queues for this server")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName("view").setDescription("Show the current queue configuration"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("timezone")
        .setDescription("Set the server timezone used for availability")
        .addStringOption((option) =>
          option
            .setName("iana")
            .setDescription("IANA timezone, e.g. Asia/Manila")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("multiple")
        .setDescription("Allow users to join more than one queue at a time")
        .addBooleanOption((option) =>
          option
            .setName("enabled")
            .setDescription("Allow multiple active queue entries")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("staff-role")
        .setDescription("Set the staff role that can manage queues")
        .addRoleOption((option) =>
          option.setName("role").setDescription("Staff role").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit-queue")
        .setDescription("Edit a queue's name, hours, and limits")
        .addStringOption((option) =>
          option
            .setName("queue")
            .setDescription("Queue to edit")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((option) =>
          option.setName("name").setDescription("Display name"),
        )
        .addStringOption((option) =>
          option.setName("emoji").setDescription("Emoji"),
        )
        .addStringOption((option) =>
          option.setName("description").setDescription("Short description"),
        )
        .addNumberOption((option) =>
          option.setName("min-hours").setDescription("Minimum hours").setMinValue(0.25),
        )
        .addNumberOption((option) =>
          option
            .setName("max-hours")
            .setDescription("Maximum hours (cap 24)")
            .setMinValue(0.25)
            .setMaxValue(ABSOLUTE_MAX_HOURS),
        )
        .addIntegerOption((option) =>
          option.setName("max-size").setDescription("Maximum waiting users (0 = unlimited)"),
        )
        .addBooleanOption((option) =>
          option.setName("allow-leave").setDescription("Allow users to leave"),
        ),
    ),
  async autocomplete(interaction, ctx) {
    await autocompleteQueue(interaction, ctx);
  },
  async execute(interaction, ctx) {
    try {
      if (!interaction.inCachedGuild() || !interaction.member) {
        await safeReply(
          interaction,
          ephemeral({ embeds: [errorEmbed("Guild only")] }),
        );
        return;
      }
      requireManageGuild(interaction.member);
      const guildId = interaction.guildId;
      const sub = interaction.options.getSubcommand();
      store.ensureGuild(ctx.db, guildId, ctx.env.DEFAULT_TIMEZONE);

      if (sub === "view") {
        const guild = store.getGuild(ctx.db, guildId)!;
        const queues = store.listQueues(ctx.db, guildId);
        const lines = queues
          .map(
            (queue) =>
              `${queue.emoji} **${queue.name}** • min ${queue.minHours}h • max ${queue.maxHours}h • ${queue.status}`,
          )
          .join("\n");
        await safeReply(
          interaction,
          ephemeral({
            embeds: [
              infoEmbed(
                "Queue configuration",
                [
                  `Timezone: \`${guild.timezone}\``,
                  `Multiple queues: ${guild.allowMultipleQueues ? "yes" : "no"}`,
                  `Staff role: ${guild.staffRoleId ? `<@&${guild.staffRoleId}>` : "_not set_"}`,
                  "",
                  lines || "_No queues._",
                ].join("\n"),
              ),
            ],
          }),
        );
        return;
      }

      if (sub === "timezone") {
        const zone = interaction.options.getString("iana", true).trim();
        if (!isValidTimeZone(zone)) {
          await safeReply(
            interaction,
            ephemeral({
              embeds: [
                errorEmbed(
                  "Invalid timezone",
                  "Use an IANA timezone such as `Asia/Manila` or `America/New_York`.",
                ),
              ],
            }),
          );
          return;
        }
        updateGuildSettings(ctx.db, guildId, { timezone: zone });
        ctx.display.schedule(guildId);
        await safeReply(
          interaction,
          ephemeral({
            embeds: [successEmbed("Timezone updated", `Availability will display in \`${zone}\`.`)],
          }),
        );
        return;
      }

      if (sub === "multiple") {
        const enabled = interaction.options.getBoolean("enabled", true);
        updateGuildSettings(ctx.db, guildId, { allowMultipleQueues: enabled });
        await safeReply(
          interaction,
          ephemeral({
            embeds: [
              successEmbed(
                "Setting updated",
                enabled
                  ? "Users can join multiple queues at the same time."
                  : "Users may only have one active queue entry.",
              ),
            ],
          }),
        );
        return;
      }

      if (sub === "staff-role") {
        const role = interaction.options.getRole("role", true);
        const bot = interaction.guild.members.me;
        if (bot && bot.roles.highest.comparePositionTo(role) <= 0 && role.id !== interaction.guild.id) {
          await safeReply(
            interaction,
            ephemeral({
              embeds: [
                errorEmbed(
                  "❌ Role Hierarchy Error",
                  `BotLenoAPP cannot manage:\n\n**${role.name}**\n\nMove the BotLenoAPP role above ${role.name} and try again.`,
                ),
              ],
            }),
          );
          return;
        }
        updateGuildSettings(ctx.db, guildId, { staffRoleId: role.id });
        await safeReply(
          interaction,
          ephemeral({
            embeds: [successEmbed("Staff role updated", `${role} can now use \`/queue-admin\`.`)],
          }),
        );
        return;
      }

      if (sub === "edit-queue") {
        const queueId = interaction.options.getString("queue", true);
        if (!isUuid(queueId)) {
          await safeReply(
            interaction,
            ephemeral({ embeds: [errorEmbed("Invalid queue.")] }),
          );
          return;
        }
        const queue = store.getQueue(ctx.db, queueId);
        if (!queue || queue.guildId !== guildId) {
          await safeReply(
            interaction,
            ephemeral({ embeds: [errorEmbed("That queue does not belong to this server.")] }),
          );
          return;
        }

        const maxSizeRaw = interaction.options.getInteger("max-size");
        store.updateQueue(ctx.db, queue.id, {
          name: interaction.options.getString("name") ?? undefined,
          emoji: interaction.options.getString("emoji") ?? undefined,
          description: interaction.options.getString("description") ?? undefined,
          minHours: interaction.options.getNumber("min-hours") ?? undefined,
          maxHours: interaction.options.getNumber("max-hours") ?? undefined,
          maxSize:
            maxSizeRaw === null || maxSizeRaw === undefined
              ? undefined
              : maxSizeRaw === 0
                ? null
                : maxSizeRaw,
          allowLeave: interaction.options.getBoolean("allow-leave") ?? undefined,
        });
        ctx.display.schedule(guildId);
        await safeReply(
          interaction,
          ephemeral({
            embeds: [successEmbed("Queue updated", `${queue.emoji} **${queue.name}** was updated.`)],
          }),
        );
      }
    } catch (error) {
      await replyAppError(interaction, error, ctx.logger, ctx.db);
    }
  },
};
