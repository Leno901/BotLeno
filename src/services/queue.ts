import { randomUUID } from "node:crypto";
import { ABSOLUTE_MAX_HOURS, SEND_JO_STRIKES_TO_REQUEUE } from "../config/defaults.js";
import type { Db } from "../database/client.js";
import * as store from "../database/store.js";
import type {
  DutyJob,
  DutyLine,
  DutyLineRow,
  DutyStatus,
  EntryStatus,
  Queue,
  QueueEntry,
  QueueStatus,
  UserQueueView,
} from "../types.js";
import { AppError } from "./errors.js";
import { parseDurationHours } from "./hours.js";
import { calculateAvailableUntil, toUtcIso } from "./time.js";

export interface JoinInput {
  guildId: string;
  queueId?: string;
  queueIds?: string[];
  userId: string;
  hoursInput: string;
  now?: Date;
}

export interface JoinResult {
  entry: QueueEntry;
  queue: Queue;
  jobs: Queue[];
  position: number;
  peopleAhead: number;
}

function requireQueue(db: Db, queueId: string, guildId: string): Queue {
  const queue = store.getQueue(db, queueId);
  if (!queue || queue.guildId !== guildId) {
    throw new AppError("That queue could not be found.", "QUEUE_NOT_FOUND");
  }
  return queue;
}

function expireGuild(db: Db, guildId: string, now: Date): QueueEntry[] {
  const expired = store.expireDueEntries(db, toUtcIso(now), guildId);
  for (const entry of expired) {
    store.insertHistory(db, {
      guildId: entry.guildId,
      queueId: entry.queueId,
      userId: entry.userId,
      actorId: "system",
      action: "expired",
      details: null,
    });
  }
  return expired;
}

function viewFor(db: Db, entry: QueueEntry, queue: Queue): UserQueueView {
  const position = store.positionFor(db, entry);
  return {
    entry,
    queue,
    jobs: store.listEntryJobs(db, entry.id),
    position,
    peopleAhead: Math.max(0, position - 1),
  };
}

function resolveQueueIds(input: JoinInput): string[] {
  const ids = input.queueIds?.length
    ? [...new Set(input.queueIds)]
    : input.queueId
      ? [input.queueId]
      : [];
  if (ids.length === 0) {
    throw new AppError("Select at least one J.O.", "INVALID_JOBS");
  }
  return ids;
}

export function joinQueue(db: Db, input: JoinInput): JoinResult {
  const now = input.now ?? new Date();

  return db.transaction(() => {
    store.ensureGuild(db, input.guildId);
    expireGuild(db, input.guildId, now);

    const guild = store.getGuild(db, input.guildId)!;
    const queueIds = resolveQueueIds(input);
    const queues = queueIds.map((queueId) => requireQueue(db, queueId, input.guildId));

    for (const queue of queues) {
      if (queue.status === "paused") {
        throw new AppError(
          `The ${queue.name} queue is currently paused by staff.\nPlease try again later.`,
          "QUEUE_PAUSED",
        );
      }
      if (queue.status === "closed") {
        throw new AppError(
          `The ${queue.name} queue is currently closed.`,
          "QUEUE_CLOSED",
        );
      }
    }

    const existingLine = store.listActiveEntriesForUser(
      db,
      input.guildId,
      input.userId,
    );
    if (existingLine.length > 0 && !guild.allowMultipleQueues) {
      const position = store.positionFor(db, existingLine[0]!);
      throw new AppError(
        `You are already #${position} in the duty line.`,
        "ALREADY_QUEUED",
      );
    }

    for (const queue of queues) {
      const existing = store.getActiveEntry(db, queue.id, input.userId);
      if (existing) {
        const position = store.positionFor(db, existing);
        throw new AppError(
          `You are already #${position} in the duty line.`,
          "ALREADY_QUEUED",
        );
      }
    }

    const minHours = Math.max(...queues.map((queue) => queue.minHours));
    const maxHours = Math.min(
      ABSOLUTE_MAX_HOURS,
      ...queues.map((queue) => queue.maxHours),
    );
    const parsed = parseDurationHours(input.hoursInput, minHours, maxHours);
    if (!parsed.ok) {
      throw new AppError(parsed.error, "INVALID_HOURS");
    }

    for (const queue of queues) {
      if (queue.maxSize !== null && store.waitingCount(db, queue.id) >= queue.maxSize) {
        throw new AppError(
          `The ${queue.name} queue is full (${queue.maxSize} players).`,
          "QUEUE_FULL",
        );
      }
    }

    const primary = queues[0]!;
    const availableUntil =
      parsed.hours == null ? null : toUtcIso(calculateAvailableUntil(now, parsed.hours));
    const entry = store.insertEntry(db, {
      id: randomUUID(),
      guildId: input.guildId,
      queueId: primary.id,
      userId: input.userId,
      sortKey: store.nextSortKey(db, input.guildId),
      durationHours: parsed.hours,
      availableUntil,
      status: "waiting",
      isAfk: false,
    });
    store.setEntryJobs(db, entry.id, queues.map((queue) => queue.id));

    store.insertHistory(db, {
      guildId: input.guildId,
      queueId: primary.id,
      userId: input.userId,
      actorId: input.userId,
      action: "joined",
      details: JSON.stringify({
        durationHours: parsed.hours,
        jobs: queues.map((queue) => queue.slug),
      }),
    });

    const position = store.positionFor(db, entry);
    return {
      entry,
      queue: primary,
      jobs: store.listEntryJobs(db, entry.id),
      position,
      peopleAhead: Math.max(0, position - 1),
    };
  })();
}

export function leaveQueue(
  db: Db,
  options: {
    guildId: string;
    userId: string;
    queueId?: string;
    actorId?: string;
    now?: Date;
    force?: boolean;
  },
): UserQueueView {
  const now = options.now ?? new Date();

  return db.transaction(() => {
    expireGuild(db, options.guildId, now);
    const active = findActive(
      db,
      options.guildId,
      options.userId,
      options.queueId,
    );
    const queue = requireQueue(db, active.queueId, options.guildId);

    if (!options.force && !queue.allowLeave) {
      throw new AppError(
        "Leaving this queue is disabled. Ask staff if you need to be removed.",
        "CANNOT_LEAVE",
      );
    }

    store.updateEntryStatus(db, active.id, "cancelled");
    store.insertHistory(db, {
      guildId: options.guildId,
      queueId: queue.id,
      userId: options.userId,
      actorId: options.actorId ?? options.userId,
      action: "left",
      details: null,
    });

    return viewFor(db, { ...active, status: "cancelled" }, queue);
  })();
}

export function getUserQueueStatus(
  db: Db,
  guildId: string,
  userId: string,
  now = new Date(),
): UserQueueView | null {
  return db.transaction(() => {
    expireGuild(db, guildId, now);
    const entries = store.listActiveEntriesForUser(db, guildId, userId);
    const entry = entries[0];
    if (!entry) return null;
    const queue = requireQueue(db, entry.queueId, guildId);
    return viewFor(db, entry, queue);
  })();
}

export function listQueueBoard(db: Db, guildId: string, now = new Date()) {
  return db.transaction(() => {
    store.ensureGuild(db, guildId);
    expireGuild(db, guildId, now);
    return store.listQueuesWithCounts(db, guildId);
  })();
}

export function listQueueDashboard(
  db: Db,
  guildId: string,
  now = new Date(),
): DutyLine {
  return listDutyLine(db, guildId, now);
}

function dutyStatus(entry: QueueEntry): DutyStatus {
  if (entry.status === "active") return "on_duty";
  if (entry.isAfk) return "afk";
  return "ready";
}

function toDutyRow(db: Db, entry: QueueEntry): DutyLineRow {
  const jobs = store.listEntryJobs(db, entry.id).map((queue) => ({
    id: queue.id,
    slug: queue.slug,
    name: queue.name,
    emoji: queue.emoji,
  }));
  const acceptedJobs = entry.acceptedJobIds
    .map((id) => jobs.find((job) => job.id === id) ?? queueJob(db, id))
    .filter((job): job is DutyJob => Boolean(job));
  return {
    entryId: entry.id,
    userId: entry.userId,
    position: store.positionFor(db, entry),
    status: dutyStatus(entry),
    jobs,
    acceptedJobs,
    durationHours: entry.durationHours,
    availableFrom: entry.createdAt,
    availableUntil: entry.availableUntil,
    updatedAt: entry.updatedAt,
  };
}

function queueJob(db: Db, queueId: string): DutyJob | null {
  const queue = store.getQueue(db, queueId);
  if (!queue) return null;
  return { id: queue.id, slug: queue.slug, name: queue.name, emoji: queue.emoji };
}

export function listDutyLine(
  db: Db,
  guildId: string,
  now = new Date(),
): DutyLine {
  return db.transaction(() => {
    store.ensureGuild(db, guildId);
    expireGuild(db, guildId, now);
    const live = store.listLiveEntries(db, guildId).map((entry) => toDutyRow(db, entry));
    const rows = live.filter((row) => row.status !== "on_duty");
    const onDuty = live.filter((row) => row.status === "on_duty");
    return {
      rows,
      inLine: rows.length,
      afkCount: rows.filter((row) => row.status === "afk").length,
      onDutyCount: onDuty.length,
      onDuty,
      jobCount: store.listQueues(db, guildId).length,
    };
  })();
}

export function toggleAfk(
  db: Db,
  options: { guildId: string; userId: string; now?: Date },
): UserQueueView {
  const now = options.now ?? new Date();
  return db.transaction(() => {
    expireGuild(db, options.guildId, now);
    const entry = findActive(db, options.guildId, options.userId);
    if (entry.status === "active") {
      throw new AppError(
        "You are on duty. Ask staff to complete the job before going AFK.",
        "CANNOT_AFK",
      );
    }
    const updated = store.updateEntryAfk(db, entry.id, !entry.isAfk);
    const queue = requireQueue(db, updated.queueId, options.guildId);
    store.insertHistory(db, {
      guildId: options.guildId,
      queueId: queue.id,
      userId: options.userId,
      actorId: options.userId,
      action: updated.isAfk ? "afk" : "ready",
      details: null,
    });
    return viewFor(db, updated, queue);
  })();
}

export function dispatchNext(
  db: Db,
  options: { guildId: string; actorId: string; now?: Date },
): UserQueueView {
  const now = options.now ?? new Date();
  return db.transaction(() => {
    expireGuild(db, options.guildId, now);
    const next = store
      .listLiveEntries(db, options.guildId)
      .find((entry) => entry.status === "waiting" && !entry.isAfk);
    if (!next) {
      throw new AppError("No one in the duty line is ready to dispatch.", "NOT_FOUND");
    }
    return transitionStaff(db, {
      guildId: options.guildId,
      entryId: next.id,
      actorId: options.actorId,
      status: "active",
      action: "dispatched",
      now,
    });
  })();
}

function offeredQueueIds(queueId: string | readonly string[]): string[] {
  return [...new Set(Array.isArray(queueId) ? queueId : [queueId])].filter(Boolean);
}

function hasAnyOfferedJob(jobs: Array<{ id: string }>, queueIds: readonly string[]): boolean {
  return queueIds.some((id) => jobs.some((job) => job.id === id));
}

export function pickReadyForJob<
  T extends { entryId: string; status: DutyStatus; jobs: Array<{ id: string }> },
>(
  rows: readonly T[],
  queueId: string | readonly string[],
  skipEntryIds: readonly string[] = [],
): T | null {
  const skip = new Set(skipEntryIds);
  const needed = offeredQueueIds(queueId);
  if (needed.length === 0) return null;
  return (
    rows.find(
      (row) =>
        row.status === "ready" &&
        !skip.has(row.entryId) &&
        hasAnyOfferedJob(row.jobs, needed),
    ) ?? null
  );
}

export function nextReadyForJob(
  db: Db,
  guildId: string,
  queueId: string | readonly string[],
  skipEntryIds: readonly string[] = [],
  now = new Date(),
) {
  return pickReadyForJob(listDutyLine(db, guildId, now).rows, queueId, skipEntryIds);
}

export function dispatchEntry(
  db: Db,
  options: {
    guildId: string;
    entryId: string;
    actorId: string;
    queueId?: string;
    queueIds?: string[];
    now?: Date;
  },
): UserQueueView {
  const now = options.now ?? new Date();
  return db.transaction(() => {
    expireGuild(db, options.guildId, now);
    const entry = store.getEntry(db, options.entryId);
    if (!entry || entry.guildId !== options.guildId) {
      throw new AppError("That queue entry could not be found.", "NOT_FOUND");
    }
    if (entry.status !== "waiting" || entry.isAfk) {
      throw new AppError("That user is not READY for this J.O.", "NOT_READY");
    }
    const jobs = store.listEntryJobs(db, entry.id);
    const offered = offeredQueueIds(options.queueIds ?? (options.queueId ? [options.queueId] : []));
    const accepted = offered.filter((id) => jobs.some((job) => job.id === id));
    if (offered.length > 0 && accepted.length === 0) {
      throw new AppError("That user is not queued for this J.O.", "NOT_READY");
    }
    if (accepted.length > 0) {
      store.updateEntryAcceptedJobs(db, entry.id, accepted);
    }
    return transitionStaff(db, {
      guildId: options.guildId,
      entryId: entry.id,
      actorId: options.actorId,
      status: "active",
      action: "dispatched",
      now,
    });
  })();
}

export function listQueueMembers(
  db: Db,
  guildId: string,
  queueId: string,
  now = new Date(),
): { queue: Queue; entries: Array<QueueEntry & { position: number }> } {
  return db.transaction(() => {
    expireGuild(db, guildId, now);
    const queue = requireQueue(db, queueId, guildId);
    const entries = store.listWaitingEntries(db, queueId).map((entry, index) => ({
      ...entry,
      position: index + 1,
    }));
    return { queue, entries };
  })();
}

function findActive(
  db: Db,
  guildId: string,
  userId: string,
  queueId?: string,
): QueueEntry {
  if (queueId) {
    const entry = store.getActiveEntry(db, queueId, userId);
    if (!entry || entry.guildId !== guildId) {
      throw new AppError("You are not in that queue.", "NOT_IN_QUEUE");
    }
    return entry;
  }

  const entries = store.listActiveEntriesForUser(db, guildId, userId);
  if (entries.length === 0) {
    throw new AppError("You are not in a queue.", "NOT_IN_QUEUE");
  }
  return entries[0]!;
}

function transitionStaff(
  db: Db,
  options: {
    guildId: string;
    entryId: string;
    actorId: string;
    status: EntryStatus;
    action: string;
    now?: Date;
  },
): UserQueueView {
  const now = options.now ?? new Date();
  return db.transaction(() => {
    expireGuild(db, options.guildId, now);
    const entry = store.getEntry(db, options.entryId);
    if (!entry || entry.guildId !== options.guildId) {
      throw new AppError("That queue entry could not be found.", "NOT_FOUND");
    }
    if (entry.status !== "waiting" && entry.status !== "active") {
      throw new AppError("That user is no longer waiting in the queue.", "NOT_IN_QUEUE");
    }
    const queue = requireQueue(db, entry.queueId, options.guildId);
    const updated = store.updateEntryStatus(db, entry.id, options.status);
    store.insertHistory(db, {
      guildId: options.guildId,
      queueId: queue.id,
      userId: entry.userId,
      actorId: options.actorId,
      action: options.action,
      details: null,
    });
    return viewFor(db, updated, queue);
  })();
}

export function recordOfferPass(
  db: Db,
  options: {
    guildId: string;
    entryId: string;
    actorId: string;
    reason: "declined" | "timeout";
    now?: Date;
  },
): { strikes: number; requeued: boolean } {
  const now = options.now ?? new Date();
  return db.transaction(() => {
    expireGuild(db, options.guildId, now);
    const entry = store.getEntry(db, options.entryId);
    if (!entry || entry.guildId !== options.guildId || entry.status !== "waiting") {
      return { strikes: 0, requeued: false };
    }
    const strikes = entry.offerStrikes + 1;
    if (strikes >= SEND_JO_STRIKES_TO_REQUEUE) {
      store.updateEntrySortKey(db, entry.id, store.nextSortKey(db, options.guildId));
      store.updateOfferStrikes(db, entry.id, 0);
      store.insertHistory(db, {
        guildId: options.guildId,
        queueId: entry.queueId,
        userId: entry.userId,
        actorId: options.actorId,
        action: "requeued",
        details: JSON.stringify({ after: options.reason, strikes }),
      });
      return { strikes, requeued: true };
    }
    store.updateOfferStrikes(db, entry.id, strikes);
    store.insertHistory(db, {
      guildId: options.guildId,
      queueId: entry.queueId,
      userId: entry.userId,
      actorId: options.actorId,
      action: options.reason,
      details: JSON.stringify({ strikes }),
    });
    return { strikes, requeued: false };
  })();
}

export function skipEntry(
  db: Db,
  options: { guildId: string; entryId: string; actorId: string; now?: Date },
): UserQueueView {
  return transitionStaff(db, { ...options, status: "skipped", action: "skipped" });
}

export function removeEntry(
  db: Db,
  options: { guildId: string; entryId: string; actorId: string; now?: Date },
): UserQueueView {
  return transitionStaff(db, { ...options, status: "cancelled", action: "removed" });
}

export function completeEntry(
  db: Db,
  options: { guildId: string; entryId: string; actorId: string; now?: Date },
): UserQueueView {
  return transitionStaff(db, {
    ...options,
    status: "completed",
    action: "completed",
  });
}

export function setQueueStatus(
  db: Db,
  options: {
    guildId: string;
    queueId: string;
    status: QueueStatus;
    actorId: string;
  },
): Queue {
  return db.transaction(() => {
    const queue = requireQueue(db, options.queueId, options.guildId);
    const updated = store.updateQueue(db, queue.id, { status: options.status });
    store.insertHistory(db, {
      guildId: options.guildId,
      queueId: queue.id,
      userId: null,
      actorId: options.actorId,
      action: options.status,
      details: null,
    });
    return updated;
  })();
}

export function clearQueue(
  db: Db,
  options: { guildId: string; queueId: string; actorId: string; now?: Date },
): { queue: Queue; cleared: number; entries: QueueEntry[] } {
  const now = options.now ?? new Date();
  return db.transaction(() => {
    expireGuild(db, options.guildId, now);
    const queue = requireQueue(db, options.queueId, options.guildId);
    const waiting = store
      .listWaitingEntries(db, queue.id)
      .filter((entry) => entry.status === "waiting");
    for (const entry of waiting) {
      store.updateEntryStatus(db, entry.id, "cancelled");
    }
    store.insertHistory(db, {
      guildId: options.guildId,
      queueId: queue.id,
      userId: null,
      actorId: options.actorId,
      action: "cleared",
      details: JSON.stringify({ count: waiting.length }),
    });
    return { queue, cleared: waiting.length, entries: waiting };
  })();
}

export function moveEntry(
  db: Db,
  options: {
    guildId: string;
    entryId: string;
    newPosition: number;
    actorId: string;
    now?: Date;
  },
): UserQueueView {
  const now = options.now ?? new Date();
  return db.transaction(() => {
    expireGuild(db, options.guildId, now);
    const entry = store.getEntry(db, options.entryId);
    if (!entry || entry.guildId !== options.guildId || (entry.status !== "waiting" && entry.status !== "active")) {
      throw new AppError("That queue entry could not be found.", "NOT_FOUND");
    }
    const queue = requireQueue(db, entry.queueId, options.guildId);
    const waiting = store.listLiveEntries(db, options.guildId);
    const from = waiting.findIndex((item) => item.id === entry.id);
    if (from < 0) {
      throw new AppError("That user is no longer waiting in the queue.", "NOT_IN_QUEUE");
    }

    const target = Math.max(1, Math.min(options.newPosition, waiting.length));
    const reordered = [...waiting];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(target - 1, 0, moved!);

    reordered.forEach((item, index) => {
      store.updateEntrySortKey(db, item.id, index + 1);
    });

    store.insertHistory(db, {
      guildId: options.guildId,
      queueId: queue.id,
      userId: entry.userId,
      actorId: options.actorId,
      action: "moved",
      details: JSON.stringify({ position: target }),
    });

    const updated = store.getEntry(db, entry.id)!;
    return viewFor(db, updated, queue);
  })();
}

export function expireDue(
  db: Db,
  now = new Date(),
  guildId?: string,
): QueueEntry[] {
  return db.transaction(() => {
    const expired = store.expireDueEntries(db, toUtcIso(now), guildId);
    for (const entry of expired) {
      store.insertHistory(db, {
        guildId: entry.guildId,
        queueId: entry.queueId,
        userId: entry.userId,
        actorId: "system",
        action: "expired",
        details: null,
      });
    }
    return expired;
  })();
}

export function updateGuildSettings(
  db: Db,
  guildId: string,
  patch: Parameters<typeof store.updateGuild>[2],
) {
  return db.transaction(() => {
    store.ensureGuild(db, guildId);
    return store.updateGuild(db, guildId, patch);
  })();
}
