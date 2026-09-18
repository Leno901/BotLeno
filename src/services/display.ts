import { ChannelType, MessageFlags, type TextChannel } from "discord.js";
import type { AppContext } from "../app-context.js";
import {
  DEFAULT_PANEL_CHANNEL,
  DEFAULT_STATUS_CHANNEL,
  LEGACY_PANEL_CHANNEL,
  LEGACY_STATUS_CHANNEL,
} from "../config/defaults.js";
import * as store from "../database/store.js";
import type { DutyLine } from "../types.js";
import { dutyLineDashboardPayload } from "../ui/dashboard.js";
import { queuePanelEmbed } from "../ui/embeds.js";
import { queueSelectRow } from "../ui/components.js";
import { hydrateDisplayNames, resolveDisplayNames } from "./display-names.js";
import { withTransientRetry } from "./discord-retry.js";
import { listQueueBoard, listDutyLine } from "./queue.js";
import { syncUserStatusChannels } from "./user-status-channel.js";

export function shouldRepostPanel(
  existingId: string | null,
  lastMessageId: string | null | undefined,
): boolean {
  return Boolean(existingId) && Boolean(lastMessageId) && existingId !== lastMessageId;
}

export async function upsertDutyLineMessage(
  channel: TextChannel,
  existingId: string | null,
  line: DutyLine,
  timezone: string,
): Promise<string> {
  const names = await resolveDisplayNames(channel.guild, [
    ...line.rows.map((row) => row.userId),
    ...line.onDuty.map((row) => row.userId),
  ]);
  const payload = dutyLineDashboardPayload(
    hydrateDisplayNames(line, names),
    timezone,
    new Date(),
  );
  const existing = existingId
    ? await channel.messages.fetch(existingId).catch(() => null)
    : null;

  if (existing && !existing.flags.has(MessageFlags.IsComponentsV2)) {
    await withTransientRetry(() => existing.edit(payload));
    return existing.id;
  }

  const message = await withTransientRetry(() => channel.send(payload));
  await message.pin().catch(() => undefined);
  if (existing) {
    await existing.delete().catch(() => undefined);
  }
  return message.id;
}

export async function refreshGuildDisplays(
  ctx: AppContext,
  guildId: string,
  options: { forcePanel?: boolean } = {},
): Promise<void> {
  const guildConfig = store.getGuild(ctx.db, guildId);
  if (!guildConfig) return;

  const discordGuild = await ctx.client.guilds.fetch(guildId).catch(() => null);
  if (!discordGuild) return;

  const queues = listQueueBoard(ctx.db, guildId);

  if (guildConfig.panelChannelId) {
    try {
      const channel = await discordGuild.channels.fetch(guildConfig.panelChannelId);
      if (channel?.type === ChannelType.GuildText) {
        if (channel.name === LEGACY_PANEL_CHANNEL) {
          await channel
            .setName(DEFAULT_PANEL_CHANNEL, "Queue start")
            .catch(() => undefined);
        }
        const payload = {
          embeds: [queuePanelEmbed(queues)],
          components: queues.length ? [queueSelectRow(queues)] : [],
        };
        const existing = guildConfig.panelMessageId
          ? await channel.messages.fetch(guildConfig.panelMessageId).catch(() => null)
          : null;
        if (
          existing &&
          !options.forcePanel &&
          !shouldRepostPanel(existing.id, channel.lastMessageId)
        ) {
          await withTransientRetry(() => existing.edit(payload));
        } else {
          const message = await withTransientRetry(() => channel.send(payload));
          store.updateGuild(ctx.db, guildId, { panelMessageId: message.id });
          if (existing) {
            await existing.delete().catch(() => undefined);
          }
        }
      }
    } catch (error) {
      ctx.logger.warn({ err: error, guildId }, "Failed to refresh queue panel");
    }
  }

  if (guildConfig.statusChannelId) {
    try {
      const channel = await discordGuild.channels.fetch(guildConfig.statusChannelId);
      if (channel?.type === ChannelType.GuildText) {
        if (channel.name === LEGACY_STATUS_CHANNEL) {
          await channel
            .setName(DEFAULT_STATUS_CHANNEL, "BotLeno live dashboard")
            .catch(() => undefined);
        }
        const dashboard = listDutyLine(ctx.db, guildId);
        const messageId = await upsertDutyLineMessage(
          channel,
          guildConfig.statusMessageId,
          dashboard,
          guildConfig.timezone,
        );
        if (messageId !== guildConfig.statusMessageId) {
          store.updateGuild(ctx.db, guildId, { statusMessageId: messageId });
        }
      }
    } catch (error) {
      ctx.logger.warn({ err: error, guildId }, "Failed to refresh queue dashboard");
    }
  }

  try {
    await syncUserStatusChannels(ctx, discordGuild);
  } catch (error) {
    ctx.logger.warn({ err: error, guildId }, "Failed to refresh personal queue status");
  }
}
