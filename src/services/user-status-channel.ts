import {
  ChannelType,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type OverwriteResolvable,
  type TextChannel,
} from "discord.js";
import type { AppContext } from "../app-context.js";
import {
  DEFAULT_STATUS_CATEGORY_NAME,
  PERSONAL_STATUS_CHANNELS_ENABLED,
} from "../config/defaults.js";
import * as store from "../database/store.js";
import type { DutyLineRow, QueueEntry } from "../types.js";
import { personalStatusPayload } from "../ui/dashboard.js";
import { resolveGuildDisplayName } from "./display-names.js";
import { listDutyLine } from "./queue.js";

const BOT_STATUS_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageChannels,
] as const;

export function personalStatusChannelName(username: string, userId: string): string {
  const slug =
    username
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "user";
  return `queue-status-${slug}-${userId.slice(-4)}`.slice(0, 100);
}

export function isPersonalStatusChannelName(name: string): boolean {
  return name.startsWith("queue-status-");
}

function usableBotRoleId(guildId: string, botId: string, botRoleId?: string): string | null {
  if (!botRoleId || botRoleId === guildId || botRoleId === botId) return null;
  return botRoleId;
}

export function statusCategoryOverwrites(
  guildId: string,
  botId: string,
  botRoleId?: string,
): OverwriteResolvable[] {
  const overwrites: OverwriteResolvable[] = [
    {
      id: guildId,
      type: OverwriteType.Role,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: botId,
      type: OverwriteType.Member,
      allow: [...BOT_STATUS_ALLOW],
    },
  ];
  const roleId = usableBotRoleId(guildId, botId, botRoleId);
  if (roleId) {
    overwrites.push({
      id: roleId,
      type: OverwriteType.Role,
      allow: [...BOT_STATUS_ALLOW],
    });
  }
  return overwrites;
}

export function personalStatusOverwrites(
  guildId: string,
  userId: string,
  botId: string,
  botRoleId?: string,
): OverwriteResolvable[] {
  const overwrites: OverwriteResolvable[] = [
    {
      id: guildId,
      type: OverwriteType.Role,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: userId,
      type: OverwriteType.Member,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages],
    },
    {
      id: botId,
      type: OverwriteType.Member,
      allow: [...BOT_STATUS_ALLOW],
    },
  ];
  const roleId = usableBotRoleId(guildId, botId, botRoleId);
  if (roleId) {
    overwrites.push({
      id: roleId,
      type: OverwriteType.Role,
      allow: [...BOT_STATUS_ALLOW],
    });
  }
  return overwrites;
}

function isLive(entry: QueueEntry): boolean {
  return entry.status === "waiting" || entry.status === "active";
}

async function fetchCategory(guild: Guild, id: string | null): Promise<CategoryChannel | null> {
  if (!id) return null;
  try {
    const channel = await guild.channels.fetch(id);
    return channel?.type === ChannelType.GuildCategory ? channel : null;
  } catch {
    return null;
  }
}

function findStatusCategory(guild: Guild): CategoryChannel | null {
  const match = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildCategory &&
      channel.name === DEFAULT_STATUS_CATEGORY_NAME,
  );
  return match?.type === ChannelType.GuildCategory ? match : null;
}

function botActorIds(guild: Guild, botId: string): { botId: string; botRoleId?: string } {
  const botRole = guild.members.me?.roles.botRole ?? guild.members.me?.roles.highest;
  return { botId, botRoleId: botRole?.id };
}

export async function ensureStatusCategory(
  ctx: AppContext,
  guild: Guild,
): Promise<CategoryChannel | null> {
  if (!PERSONAL_STATUS_CHANNELS_ENABLED) return null;
  const botId = ctx.client.user?.id;
  if (!botId) {
    ctx.logger.warn({ guildId: guild.id }, "Cannot ensure queue-status category: bot user missing");
    return null;
  }

  const { botRoleId } = botActorIds(guild, botId);
  const overwrites = statusCategoryOverwrites(guild.id, botId, botRoleId);
  const guildConfig = store.getGuild(ctx.db, guild.id);

  let category = await fetchCategory(guild, guildConfig?.statusCategoryId ?? null);
  if (!category) {
    await guild.channels.fetch().catch(() => undefined);
    category = findStatusCategory(guild);
  }
  if (!category) {
    try {
      category = await guild.channels.create({
        name: DEFAULT_STATUS_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        reason: "Private personal queue-status category",
        permissionOverwrites: overwrites,
      });
    } catch (error) {
      ctx.logger.warn(
        { err: error, guildId: guild.id },
        "Failed to create private queue-status category",
      );
      return null;
    }
  }

  try {
    await category.permissionOverwrites.set(overwrites, "Repair private queue-status category");
  } catch (error) {
    ctx.logger.warn(
      { err: error, guildId: guild.id, categoryId: category.id },
      "Failed to repair queue-status category overwrites",
    );
  }

  if (guildConfig?.statusCategoryId !== category.id) {
    store.updateGuild(ctx.db, guild.id, { statusCategoryId: category.id });
  }
  return category;
}

async function sealPersonalChannel(
  ctx: AppContext,
  channel: TextChannel,
  userId: string,
  statusCategory: CategoryChannel | null,
): Promise<void> {
  const botId = ctx.client.user?.id;
  if (!botId) {
    ctx.logger.warn({ channelId: channel.id, userId }, "Cannot lock queue-status: bot user missing");
    return;
  }

  const { botRoleId } = botActorIds(channel.guild, botId);
  const overwrites = personalStatusOverwrites(channel.guild.id, userId, botId, botRoleId);

  try {
    if (statusCategory && (channel.parentId !== statusCategory.id || channel.permissionsLocked)) {
      await channel.setParent(statusCategory.id, {
        lockPermissions: false,
        reason: "Place personal queue-status in private category",
      });
    }
    await channel.permissionOverwrites.set(overwrites, "Lock personal queue status");
    const everyone = channel.permissionOverwrites.cache.get(channel.guild.id);
    const member = channel.permissionOverwrites.cache.get(userId);
    const bot = channel.permissionOverwrites.cache.get(botId);
    if (
      !everyone?.deny.has(PermissionFlagsBits.ViewChannel) ||
      !member?.allow.has(PermissionFlagsBits.ViewChannel) ||
      !bot?.allow.has(PermissionFlagsBits.ViewChannel)
    ) {
      ctx.logger.warn(
        { channelId: channel.id, userId, overwriteCount: channel.permissionOverwrites.cache.size },
        "Personal queue-status overwrites did not apply",
      );
    }
  } catch (error) {
    ctx.logger.warn(
      { err: error, channelId: channel.id, userId },
      "Failed to lock personal queue-status overwrites",
    );
  }
}

export async function closeUserStatusChannel(
  ctx: AppContext,
  guild: Guild,
  entry: QueueEntry,
): Promise<void> {
  if (!entry.statusChannelId) return;
  const channel = await guild.channels.fetch(entry.statusChannelId).catch(() => null);
  if (channel) {
    await channel.delete("Queue status finished").catch((error) => {
      ctx.logger.warn(
        { err: error, channelId: channel.id, userId: entry.userId },
        "Failed to delete personal queue-status channel",
      );
    });
  }
  store.updateEntryStatusChannel(ctx.db, entry.id, null, null);
}

async function upsertStatusMessage(
  ctx: AppContext,
  channel: TextChannel,
  entry: QueueEntry,
  row: DutyLineRow,
  timezone: string,
  jobCount: number,
): Promise<string> {
  const payload = personalStatusPayload({
    row,
    timezone,
    jobCount,
    peopleAhead: Math.max(0, row.position - 1),
    allowLeave: store.listEntryJobs(ctx.db, entry.id).every((job) => job.allowLeave),
  });
  const existing = entry.statusMessageId
    ? await channel.messages.fetch(entry.statusMessageId).catch(() => null)
    : null;
  if (existing?.flags.has(MessageFlags.IsComponentsV2)) {
    await existing.edit(payload);
    return existing.id;
  }
  if (existing) await existing.delete().catch(() => undefined);
  const message = await channel.send(payload);
  await message.pin().catch(() => undefined);
  return message.id;
}

export async function openUserStatusChannel(
  ctx: AppContext,
  guild: Guild,
  entry: QueueEntry,
  displayName: string,
): Promise<TextChannel | null> {
  if (!PERSONAL_STATUS_CHANNELS_ENABLED) return null;
  const guildConfig = store.getGuild(ctx.db, entry.guildId);
  if (!guildConfig) return null;

  const botId = ctx.client.user?.id;
  if (!botId) return null;

  const statusCategory = await ensureStatusCategory(ctx, guild);
  if (!statusCategory) {
    ctx.logger.warn(
      { guildId: guild.id, userId: entry.userId },
      "Cannot open queue-status: private category missing",
    );
    return null;
  }

  let channel: TextChannel | null = null;
  if (entry.statusChannelId) {
    const existing = await guild.channels.fetch(entry.statusChannelId).catch(() => null);
    if (existing?.type === ChannelType.GuildText) channel = existing;
  }

  if (!channel) {
    const { botRoleId } = botActorIds(guild, botId);
    const created = await guild.channels.create({
      name: personalStatusChannelName(displayName, entry.userId),
      type: ChannelType.GuildText,
      parent: statusCategory.id,
      topic: "Your live duty line status",
      reason: "Personal queue status",
      permissionOverwrites: personalStatusOverwrites(
        guild.id,
        entry.userId,
        botId,
        botRoleId,
      ),
    });
    channel = created;
    store.updateEntryStatusChannel(ctx.db, entry.id, channel.id, null);
    await sealPersonalChannel(ctx, channel, entry.userId, statusCategory);
  } else {
    if (entry.statusChannelId !== channel.id) {
      store.updateEntryStatusChannel(ctx.db, entry.id, channel.id, entry.statusMessageId);
    }
    await sealPersonalChannel(ctx, channel, entry.userId, statusCategory);
  }

  const line = listDutyLine(ctx.db, entry.guildId);
  const row = line.rows.find((item) => item.entryId === entry.id);
  if (!row || !channel) return channel;

  const messageId = await upsertStatusMessage(
    ctx,
    channel,
    entry,
    { ...row, displayName },
    guildConfig.timezone,
    line.jobCount,
  );
  store.updateEntryStatusChannel(ctx.db, entry.id, channel.id, messageId);
  return channel;
}

async function sweepOrphanStatusChannels(
  ctx: AppContext,
  guild: Guild,
  keepIds: Set<string>,
): Promise<void> {
  await guild.channels.fetch().catch(() => undefined);
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText) continue;
    if (!isPersonalStatusChannelName(channel.name)) continue;
    if (keepIds.has(channel.id)) continue;
    await channel.delete("Orphan personal queue status").catch((error) => {
      ctx.logger.warn(
        { err: error, guildId: guild.id, channelId: channel.id },
        "Failed to delete orphan queue-status channel",
      );
    });
  }
}

async function retirePersonalStatusChannels(
  ctx: AppContext,
  guild: Guild,
): Promise<void> {
  const tracked = store.listEntriesWithStatusChannel(ctx.db, guild.id);
  for (const entry of tracked) {
    await closeUserStatusChannel(ctx, guild, entry);
  }
  await sweepOrphanStatusChannels(ctx, guild, new Set());

  const guildConfig = store.getGuild(ctx.db, guild.id);
  let category = await fetchCategory(guild, guildConfig?.statusCategoryId ?? null);
  if (!category) {
    await guild.channels.fetch().catch(() => undefined);
    category = findStatusCategory(guild);
  }
  if (!category) {
    if (guildConfig?.statusCategoryId) {
      store.updateGuild(ctx.db, guild.id, { statusCategoryId: null });
    }
    return;
  }
  const occupied = guild.channels.cache.some((channel) => channel.parentId === category.id);
  if (occupied) return;
  await category.delete("Personal queue-status disabled").catch((error) => {
    ctx.logger.warn(
      { err: error, guildId: guild.id, categoryId: category.id },
      "Failed to delete empty queue-status category",
    );
  });
  store.updateGuild(ctx.db, guild.id, { statusCategoryId: null });
}

export async function syncUserStatusChannels(
  ctx: AppContext,
  guild: Guild,
): Promise<void> {
  if (!PERSONAL_STATUS_CHANNELS_ENABLED) {
    await retirePersonalStatusChannels(ctx, guild);
    return;
  }

  const statusCategory = await ensureStatusCategory(ctx, guild);

  const live = store.listLiveEntries(ctx.db, guild.id);
  const liveIds = new Set(live.map((entry) => entry.id));
  const tracked = store.listEntriesWithStatusChannel(ctx.db, guild.id);

  for (const entry of tracked) {
    if (!isLive(entry) || !liveIds.has(entry.id)) {
      await closeUserStatusChannel(ctx, guild, entry);
    }
  }

  const line = listDutyLine(ctx.db, guild.id);
  const timezone = store.getGuild(ctx.db, guild.id)?.timezone ?? ctx.env.DEFAULT_TIMEZONE;
  const keepIds = new Set<string>();

  for (const row of line.rows) {
    const entry = store.getEntry(ctx.db, row.entryId);
    if (!entry) continue;
    try {
      const name = await resolveGuildDisplayName(guild, row.userId);
      if (!entry.statusChannelId) {
        const opened = await openUserStatusChannel(ctx, guild, entry, name);
        if (opened) keepIds.add(opened.id);
        continue;
      }
      const channel = await guild.channels.fetch(entry.statusChannelId).catch(() => null);
      if (channel?.type !== ChannelType.GuildText) {
        const opened = await openUserStatusChannel(ctx, guild, entry, name);
        if (opened) keepIds.add(opened.id);
        continue;
      }
      await sealPersonalChannel(ctx, channel, entry.userId, statusCategory);
      const messageId = await upsertStatusMessage(
        ctx,
        channel,
        entry,
        { ...row, displayName: name },
        timezone,
        line.jobCount,
      );
      keepIds.add(channel.id);
      if (messageId !== entry.statusMessageId) {
        store.updateEntryStatusChannel(ctx.db, entry.id, channel.id, messageId);
      }
    } catch (error) {
      ctx.logger.warn(
        { err: error, guildId: guild.id, userId: row.userId },
        "Failed to refresh personal queue status",
      );
    }
  }

  await sweepOrphanStatusChannels(ctx, guild, keepIds);
}
