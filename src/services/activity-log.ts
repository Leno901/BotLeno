import { ChannelType } from "discord.js";
import type { AppContext } from "../app-context.js";
import * as store from "../database/store.js";
import type { QueueEntry } from "../types.js";
import { discordTimestamp } from "./time.js";
import { queueLogEmbed } from "../ui/embeds.js";

export interface QueueLogEvent {
  action: string;
  userId?: string | null;
  actorId?: string;
  detail?: string;
  at?: Date | string;
}

const TERMINAL_ACTIONS = new Set([
  "completed",
  "left",
  "expired",
  "removed",
  "skipped",
  "cancelled",
  "cleared",
]);

const ACTION_TITLES: Record<string, string> = {
  joined: "Joined",
  left: "Left",
  move: "Moved",
  moved: "Moved",
  skipped: "Skipped",
  skip: "Skipped",
  removed: "Removed",
  remove: "Removed",
  completed: "Completed",
  complete: "Completed",
  dispatched: "Dispatched",
  expired: "Expired",
  hours: "Hours",
  ready: "Ready",
  paused: "Paused",
  pause: "Paused",
  open: "Opened",
  opened: "Opened",
  resume: "Opened",
  closed: "Closed",
  close: "Closed",
  cleared: "Cleared",
  clear: "Cleared",
  "j.o. offered": "J.O. offered",
  "j.o. accepted": "J.O. accepted",
  "j.o. declined": "J.O. declined",
  "j.o. timeout": "J.O. timed out",
  "j.o. next": "J.O. next",
  "j.o. unreachable": "J.O. unreachable",
  "j.o. exhausted": "J.O. exhausted",
};

function mentionUser(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `<@${userId}>`;
}

function actorLabel(actorId: string | undefined): string {
  if (!actorId || actorId === "system") return "System";
  return `<@${actorId}>`;
}

export function queueLogTitle(action: string): string {
  return ACTION_TITLES[action.toLowerCase()] ?? action;
}

export function describeQueueAction(event: QueueLogEvent): string {
  const user = mentionUser(event.userId) ?? "someone";
  const actor = actorLabel(event.actorId);
  const detail = event.detail?.trim();
  const extra = detail ? ` (${detail})` : "";
  const key = event.action.toLowerCase();

  switch (key) {
    case "joined":
      return `${user} joined the duty line${extra}.`;
    case "left":
      return `${user} left the duty line.`;
    case "move":
    case "moved":
      return `${actor} moved ${user}${detail ? ` to ${detail}` : ""} in the duty line.`;
    case "skip":
    case "skipped":
      return `${actor} skipped ${user} on the duty line.`;
    case "remove":
    case "removed":
      return `${actor} removed ${user} from the duty line.`;
    case "complete":
    case "completed":
      return `${actor} marked ${user}'s job complete.`;
    case "dispatched":
      return `${actor} dispatched ${user} — they are now on duty${extra}.`;
    case "expired":
      return `${user}'s availability expired${extra}.`;
    case "hours":
      return `${user} updated job hours${extra}.`;
    case "ready":
      return `${user} is ready on the duty line.`;
    case "paused":
    case "pause":
      return `${actor} paused the ${detail ?? "queue"} queue.`;
    case "closed":
    case "close":
      return `${actor} closed the ${detail ?? "queue"} queue.`;
    case "open":
    case "opened":
    case "resume":
      return `${actor} opened the ${detail ?? "queue"} queue.`;
    case "cleared":
    case "clear":
      return `${actor} cleared the queue${extra}.`;
    case "j.o. offered":
      return `${actor} offered a ${detail ?? "J.O."} job to ${user}.`;
    case "j.o. accepted":
      return `${user} accepted the ${detail ?? "J.O."} job.`;
    case "j.o. declined":
      return `${user} declined the ${detail ?? "J.O."} job.`;
    case "j.o. timeout":
      return `${user} did not respond to the ${detail ?? "J.O."} offer in time.`;
    case "j.o. next":
      return `${actor} offered the ${detail ?? "J.O."} job to the next person, ${user}.`;
    case "j.o. unreachable":
      return `${user} could not be reached for the ${detail ?? "J.O."} offer.`;
    case "j.o. exhausted":
      return `No one in line accepted the ${detail ?? "J.O."} job.`;
    default:
      return `${actor} ${event.action} ${user}${extra}.`.replace("  ", " ");
  }
}

function stamp(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return discordTimestamp(value);
}

export function formatQueueLog(
  event: QueueLogEvent,
  dates: {
    activityAt: string | Date;
    activeAt?: string | Date | null;
    doneAt?: string | Date | null;
  },
): {
  title: string;
  what: string;
  user: string;
  by: string;
  active: string;
  activity: string;
  done: string;
} {
  const terminal = TERMINAL_ACTIONS.has(event.action.toLowerCase());
  const activityAt = dates.activityAt;
  const doneAt = terminal ? (dates.doneAt ?? activityAt) : dates.doneAt;

  return {
    title: queueLogTitle(event.action),
    what: describeQueueAction(event),
    user: mentionUser(event.userId) ?? "—",
    by: actorLabel(event.actorId),
    active: stamp(dates.activeAt ?? activityAt),
    activity: stamp(activityAt),
    done: stamp(doneAt),
  };
}

function datesForEvent(
  entry: QueueEntry | null,
  event: QueueLogEvent,
  activityAt: Date,
): { activityAt: Date; activeAt: string | Date; doneAt: string | Date | null } {
  const terminal = TERMINAL_ACTIONS.has(event.action.toLowerCase());
  return {
    activityAt,
    activeAt: entry?.createdAt ?? activityAt,
    doneAt: terminal ? activityAt : (entry?.availableUntil ?? null),
  };
}

export function logQueueActivity(
  ctx: AppContext,
  guildId: string,
  event: QueueLogEvent,
): void {
  void postQueueLog(ctx, guildId, event);
}

async function postQueueLog(
  ctx: AppContext,
  guildId: string,
  event: QueueLogEvent,
): Promise<void> {
  const guild = store.getGuild(ctx.db, guildId);
  if (!guild?.logsChannelId) return;

  try {
    const channel = await ctx.client.channels.fetch(guild.logsChannelId);
    if (channel?.type !== ChannelType.GuildText) return;

    const activityAt = event.at ? new Date(event.at) : new Date();
    const entry = event.userId
      ? store.getLatestEntryForUser(ctx.db, guildId, event.userId)
      : null;
    const log = formatQueueLog(event, datesForEvent(entry, event, activityAt));

    await channel.send({
      allowedMentions: { parse: [] },
      embeds: [queueLogEmbed(log)],
    });
  } catch (error) {
    ctx.logger.warn(
      { err: error, guildId, action: event.action },
      "Failed to post queue log",
    );
  }
}
