import { ChannelType, MessageFlags, type Guild, type TextChannel } from "discord.js";
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
import { AppError } from "./errors.js";
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

async function resolveQueueStartChannel(
  guild: Guild,
  storedId: string | null,
): Promise<TextChannel | null> {
  if (storedId) {
    const byId = await guild.channels.fetch(storedId).catch(() => null);
    if (byId?.type === ChannelType.GuildText) return byId;
  }
  await guild.channels.fetch().catch(() => undefined);
  const byName = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      (channel.name === DEFAULT_PANEL_CHANNEL || channel.name === LEGACY_PANEL_CHANNEL),
  );
  return byName?.type === ChannelType.GuildText ? byName : null;
}

export async function upsertQueueStartPanel(
  ctx: AppContext,
  guild: Guild,
  options: { force?: boolean } = {},
): Promise<TextChannel> {
  const guildConfig = store.getGuild(ctx.db, guild.id);
  if (!guildConfig) {
    throw new AppError("This server is not set up. Run `/setup` first.", "NOT_SETUP");
  }

  const channel = await resolveQueueStartChannel(guild, guildConfig.panelChannelId);
  if (!channel) {
    throw new AppError(
      "Could not find **#queue-start**. Run `/setup` to recreate it.",
      "PANEL_CHANNEL_MISSING",
    );
  }

  if (channel.name === LEGACY_PANEL_CHANNEL) {
    await channel.setName(DEFAULT_PANEL_CHANNEL, "Queue start").catch(() => undefined);
  }
  if (channel.id !== guildConfig.panelChannelId) {
    store.updateGuild(ctx.db, guild.id, { panelChannelId: channel.id });
  }

  const queues = listQueueBoard(ctx.db, guild.id);
  const payload = {
    embeds: [queuePanelEmbed(queues)],
    components: queues.length ? [queueSelectRow(queues)] : [],
  };
  const existing = guildConfig.panelMessageId
    ? await channel.messages.fetch(guildConfig.panelMessageId).catch(() => null)
    : null;
  const reuse =
    Boolean(existing) &&
    !options.force &&
    !shouldRepostPanel(existing!.id, channel.lastMessageId);

  const message = reuse
    ? await withTransientRetry(() => existing!.edit(payload))
    : await withTransientRetry(() => channel.send(payload));
  await message.pin().catch(() => undefined);
  store.updateGuild(ctx.db, guild.id, { panelMessageId: message.id });
  if (!reuse && existing) {
    await existing.delete().catch(() => undefined);
  }
  return channel;
}

export async function refreshGuildDisplays(
  ctx: AppContext,
  guildId: string,
  options: { forcePanel?: boolean; requirePanel?: boolean } = {},
): Promise<void> {
  const guildConfig = store.getGuild(ctx.db, guildId);
  if (!guildConfig) return;

  const discordGuild = await ctx.client.guilds.fetch(guildId).catch(() => null);
  if (!discordGuild) return;

  try {
    await upsertQueueStartPanel(ctx, discordGuild, { force: options.forcePanel });
  } catch (error) {
    if (options.requirePanel) throw error;
    ctx.logger.warn({ err: error, guildId }, "Failed to refresh queue panel");
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
