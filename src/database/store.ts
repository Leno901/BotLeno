import { randomUUID } from "node:crypto";
import { DEFAULT_QUEUES, DEFAULT_TIMEZONE } from "../config/defaults.js";
import type {
  EntryStatus,
  GuildConfig,
  JobHourPref,
  Queue,
  QueueEntry,
  QueueHistoryRow,
  QueueStatus,
  QueueWithCount,
} from "../types.js";
import type { Db } from "./client.js";

interface GuildRow {
  id: string;
  timezone: string;
  allow_multiple_queues: number;
  staff_role_id: string | null;
  category_id: string | null;
  status_category_id: string | null;
  panel_channel_id: string | null;
  status_channel_id: string | null;
  admin_channel_id: string | null;
  logs_channel_id: string | null;
  panel_message_id: string | null;
  status_message_id: string | null;
  created_at: string;
  updated_at: string;
}

interface QueueRow {
  id: string;
  guild_id: string;
  slug: string;
  name: string;
  emoji: string;
  description: string;
  min_hours: number;
  max_hours: number;
  max_size: number | null;
  status: QueueStatus;
  sort_order: number;
  allow_leave: number;
  entries_expire: number;
  created_at: string;
  updated_at: string;
}

interface EntryRow {
  id: string;
  guild_id: string;
  queue_id: string;
  user_id: string;
  sort_key: number;
  duration_hours: number | null;
  available_until: string | null;
  status: EntryStatus;
  is_afk: number;
  offer_strikes: number;
  status_channel_id: string | null;
  status_message_id: string | null;
  accepted_job_ids: string | null;
  job_hour_prefs: string | null;
  created_at: string;
  updated_at: string;
}

function mapGuild(row: GuildRow): GuildConfig {
  return {
    id: row.id,
    timezone: row.timezone,
    allowMultipleQueues: Boolean(row.allow_multiple_queues),
    staffRoleId: row.staff_role_id,
    categoryId: row.category_id,
    statusCategoryId: row.status_category_id ?? null,
    panelChannelId: row.panel_channel_id,
    statusChannelId: row.status_channel_id,
    adminChannelId: row.admin_channel_id,
    logsChannelId: row.logs_channel_id,
    panelMessageId: row.panel_message_id,
    statusMessageId: row.status_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapQueue(row: QueueRow): Queue {
  return {
    id: row.id,
    guildId: row.guild_id,
    slug: row.slug,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    minHours: row.min_hours,
    maxHours: row.max_hours,
    maxSize: row.max_size,
    status: row.status,
    sortOrder: row.sort_order,
    allowLeave: Boolean(row.allow_leave),
    entriesExpire: Boolean(row.entries_expire),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEntry(row: EntryRow): QueueEntry {
  return {
    id: row.id,
    guildId: row.guild_id,
    queueId: row.queue_id,
    userId: row.user_id,
    sortKey: row.sort_key,
    durationHours: row.duration_hours,
    availableUntil: row.available_until,
    status: row.status,
    isAfk: Boolean(row.is_afk),
    offerStrikes: row.offer_strikes ?? 0,
    statusChannelId: row.status_channel_id ?? null,
    statusMessageId: row.status_message_id ?? null,
    acceptedJobIds: parseAcceptedJobIds(row.accepted_job_ids),
    jobHourPrefs: parseJobHourPrefs(row.job_hour_prefs),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseAcceptedJobIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

function parseJobHourPrefs(raw: string | null | undefined): Record<string, JobHourPref> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, JobHourPref> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const min = "min" in value ? (value as { min: unknown }).min : null;
      const max = "max" in value ? (value as { max: unknown }).max : null;
      out[id] = {
        min: typeof min === "number" && Number.isFinite(min) ? min : null,
        max: typeof max === "number" && Number.isFinite(max) ? max : null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function ensureGuild(
  db: Db,
  guildId: string,
  timezone = DEFAULT_TIMEZONE,
): GuildConfig {
  const existing = getGuild(db, guildId);
  if (existing) return existing;

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO guilds (id, timezone, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(guildId, timezone, now, now);

  seedDefaultQueues(db, guildId);
  return getGuild(db, guildId)!;
}

export function getGuild(db: Db, guildId: string): GuildConfig | null {
  const row = db
    .prepare("SELECT * FROM guilds WHERE id = ?")
    .get(guildId) as GuildRow | undefined;
  return row ? mapGuild(row) : null;
}

export function updateGuild(
  db: Db,
  guildId: string,
  patch: Partial<{
    timezone: string;
    allowMultipleQueues: boolean;
    staffRoleId: string | null;
    categoryId: string | null;
    statusCategoryId: string | null;
    panelChannelId: string | null;
    statusChannelId: string | null;
    adminChannelId: string | null;
    logsChannelId: string | null;
    panelMessageId: string | null;
    statusMessageId: string | null;
  }>,
): GuildConfig {
  const current = ensureGuild(db, guildId);
  const next = {
    timezone: patch.timezone ?? current.timezone,
    allowMultipleQueues:
      patch.allowMultipleQueues ?? current.allowMultipleQueues,
    staffRoleId:
      patch.staffRoleId === undefined ? current.staffRoleId : patch.staffRoleId,
    categoryId:
      patch.categoryId === undefined ? current.categoryId : patch.categoryId,
    statusCategoryId:
      patch.statusCategoryId === undefined
        ? current.statusCategoryId
        : patch.statusCategoryId,
    panelChannelId:
      patch.panelChannelId === undefined
        ? current.panelChannelId
        : patch.panelChannelId,
    statusChannelId:
      patch.statusChannelId === undefined
        ? current.statusChannelId
        : patch.statusChannelId,
    adminChannelId:
      patch.adminChannelId === undefined
        ? current.adminChannelId
        : patch.adminChannelId,
    logsChannelId:
      patch.logsChannelId === undefined
        ? current.logsChannelId
        : patch.logsChannelId,
    panelMessageId:
      patch.panelMessageId === undefined
        ? current.panelMessageId
        : patch.panelMessageId,
    statusMessageId:
      patch.statusMessageId === undefined
        ? current.statusMessageId
        : patch.statusMessageId,
  };

  db.prepare(
    `UPDATE guilds SET
      timezone = ?,
      allow_multiple_queues = ?,
      staff_role_id = ?,
      category_id = ?,
      status_category_id = ?,
      panel_channel_id = ?,
      status_channel_id = ?,
      admin_channel_id = ?,
      logs_channel_id = ?,
      panel_message_id = ?,
      status_message_id = ?,
      updated_at = ?
     WHERE id = ?`,
  ).run(
    next.timezone,
    next.allowMultipleQueues ? 1 : 0,
    next.staffRoleId,
    next.categoryId,
    next.statusCategoryId,
    next.panelChannelId,
    next.statusChannelId,
    next.adminChannelId,
    next.logsChannelId,
    next.panelMessageId,
    next.statusMessageId,
    new Date().toISOString(),
    guildId,
  );

  return getGuild(db, guildId)!;
}

export function seedDefaultQueues(db: Db, guildId: string): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO queues (
      id, guild_id, slug, name, emoji, description, min_hours, max_hours,
      max_size, status, sort_order, allow_leave, entries_expire, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0.5, 24, NULL, 'open', ?, 1, 1, ?, ?)`,
  );

  for (const template of DEFAULT_QUEUES) {
    if (getQueueBySlug(db, guildId, template.slug)) continue;
    insert.run(
      randomUUID(),
      guildId,
      template.slug,
      template.name,
      template.emoji,
      template.description,
      template.sortOrder,
      now,
      now,
    );
  }
}

export function listQueues(db: Db, guildId: string): Queue[] {
  const rows = db
    .prepare(
      "SELECT * FROM queues WHERE guild_id = ? ORDER BY sort_order ASC, name ASC",
    )
    .all(guildId) as QueueRow[];
  return rows.map(mapQueue);
}

export function listQueuesWithCounts(db: Db, guildId: string): QueueWithCount[] {
  const rows = db
    .prepare(
      `SELECT q.*,
        (
          SELECT COUNT(DISTINCT e.id)
          FROM queue_entries e
          JOIN queue_entry_jobs j ON j.entry_id = e.id
          WHERE j.queue_id = q.id AND e.status = 'waiting'
        ) AS waiting_count
       FROM queues q
       WHERE q.guild_id = ?
       ORDER BY q.sort_order ASC, q.name ASC`,
    )
    .all(guildId) as Array<QueueRow & { waiting_count: number }>;

  return rows.map((row) => ({
    ...mapQueue(row),
    waitingCount: row.waiting_count,
  }));
}

export function getQueue(db: Db, queueId: string): Queue | null {
  const row = db
    .prepare("SELECT * FROM queues WHERE id = ?")
    .get(queueId) as QueueRow | undefined;
  return row ? mapQueue(row) : null;
}

export function getQueueBySlug(
  db: Db,
  guildId: string,
  slug: string,
): Queue | null {
  const row = db
    .prepare("SELECT * FROM queues WHERE guild_id = ? AND slug = ?")
    .get(guildId, slug) as QueueRow | undefined;
  return row ? mapQueue(row) : null;
}

export function updateQueue(
  db: Db,
  queueId: string,
  patch: Partial<{
    name: string;
    emoji: string;
    description: string;
    minHours: number;
    maxHours: number;
    maxSize: number | null;
    status: QueueStatus;
    allowLeave: boolean;
    entriesExpire: boolean;
  }>,
): Queue {
  const current = getQueue(db, queueId);
  if (!current) throw new Error("Queue not found");

  db.prepare(
    `UPDATE queues SET
      name = ?, emoji = ?, description = ?, min_hours = ?, max_hours = ?,
      max_size = ?, status = ?, allow_leave = ?, entries_expire = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.name ?? current.name,
    patch.emoji ?? current.emoji,
    patch.description ?? current.description,
    patch.minHours ?? current.minHours,
    patch.maxHours ?? current.maxHours,
    patch.maxSize === undefined ? current.maxSize : patch.maxSize,
    patch.status ?? current.status,
    (patch.allowLeave ?? current.allowLeave) ? 1 : 0,
    (patch.entriesExpire ?? current.entriesExpire) ? 1 : 0,
    new Date().toISOString(),
    queueId,
  );

  return getQueue(db, queueId)!;
}

export function getEntry(db: Db, entryId: string): QueueEntry | null {
  const row = db
    .prepare("SELECT * FROM queue_entries WHERE id = ?")
    .get(entryId) as EntryRow | undefined;
  return row ? mapEntry(row) : null;
}

export function getActiveEntry(
  db: Db,
  queueId: string,
  userId: string,
): QueueEntry | null {
  const row = db
    .prepare(
      `SELECT e.* FROM queue_entries e
       JOIN queue_entry_jobs j ON j.entry_id = e.id
       WHERE j.queue_id = ? AND e.user_id = ? AND e.status IN ('waiting', 'active')`,
    )
    .get(queueId, userId) as EntryRow | undefined;
  return row ? mapEntry(row) : null;
}

export function listActiveEntriesForUser(
  db: Db,
  guildId: string,
  userId: string,
): QueueEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM queue_entries
       WHERE guild_id = ? AND user_id = ? AND status IN ('waiting', 'active')
       ORDER BY created_at ASC`,
    )
    .all(guildId, userId) as EntryRow[];
  return rows.map(mapEntry);
}

export function getLatestEntryForUser(
  db: Db,
  guildId: string,
  userId: string,
): QueueEntry | null {
  const row = db
    .prepare(
      `SELECT * FROM queue_entries
       WHERE guild_id = ? AND user_id = ?
       ORDER BY created_at DESC, updated_at DESC
       LIMIT 1`,
    )
    .get(guildId, userId) as EntryRow | undefined;
  return row ? mapEntry(row) : null;
}

export function listWaitingEntries(db: Db, queueId: string): QueueEntry[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT e.* FROM queue_entries e
       JOIN queue_entry_jobs j ON j.entry_id = e.id
       WHERE j.queue_id = ? AND e.status IN ('waiting', 'active')
       ORDER BY e.sort_key ASC, e.created_at ASC`,
    )
    .all(queueId) as EntryRow[];
  return rows.map(mapEntry);
}

export function waitingCount(db: Db, queueId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT e.id) AS n
       FROM queue_entries e
       JOIN queue_entry_jobs j ON j.entry_id = e.id
       WHERE j.queue_id = ? AND e.status = 'waiting'`,
    )
    .get(queueId) as { n: number };
  return row.n;
}

export function nextSortKey(db: Db, guildId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(sort_key), 0) AS max_key
       FROM queue_entries WHERE guild_id = ?`,
    )
    .get(guildId) as { max_key: number };
  return row.max_key + 1;
}

export function insertEntry(
  db: Db,
  entry: Omit<
    QueueEntry,
    "createdAt" | "updatedAt" | "statusChannelId" | "statusMessageId" | "offerStrikes" | "acceptedJobIds" | "jobHourPrefs"
  > & {
    createdAt?: string;
    updatedAt?: string;
  },
): QueueEntry {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO queue_entries (
      id, guild_id, queue_id, user_id, sort_key, duration_hours,
      available_until, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.guildId,
    entry.queueId,
    entry.userId,
    entry.sortKey,
    entry.durationHours,
    entry.availableUntil,
    entry.status,
    entry.createdAt ?? now,
    entry.updatedAt ?? now,
  );
  return getEntry(db, entry.id)!;
}

export function setEntryJobs(db: Db, entryId: string, queueIds: string[]): void {
  db.prepare("DELETE FROM queue_entry_jobs WHERE entry_id = ?").run(entryId);
  const insert = db.prepare(
    "INSERT INTO queue_entry_jobs (entry_id, queue_id) VALUES (?, ?)",
  );
  for (const queueId of queueIds) {
    insert.run(entryId, queueId);
  }
}

export function listEntryJobs(db: Db, entryId: string): Queue[] {
  const rows = db
    .prepare(
      `SELECT q.* FROM queues q
       JOIN queue_entry_jobs j ON j.queue_id = q.id
       WHERE j.entry_id = ?
       ORDER BY q.sort_order ASC, q.name ASC`,
    )
    .all(entryId) as QueueRow[];
  const jobs = rows.map(mapQueue);
  if (jobs.length > 0) return jobs;
  const entry = getEntry(db, entryId);
  if (!entry) return [];
  const queue = getQueue(db, entry.queueId);
  return queue ? [queue] : [];
}

export function listLiveEntries(db: Db, guildId: string): QueueEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM queue_entries
       WHERE guild_id = ? AND status IN ('waiting', 'active')
       ORDER BY sort_key ASC, created_at ASC`,
    )
    .all(guildId) as EntryRow[];
  return rows.map(mapEntry);
}

export function updateEntryStatusChannel(
  db: Db,
  entryId: string,
  statusChannelId: string | null,
  statusMessageId: string | null,
): QueueEntry {
  db.prepare(
    `UPDATE queue_entries
     SET status_channel_id = ?, status_message_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(statusChannelId, statusMessageId, new Date().toISOString(), entryId);
  return getEntry(db, entryId)!;
}

export function listEntriesWithStatusChannel(db: Db, guildId: string): QueueEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM queue_entries
       WHERE guild_id = ? AND status_channel_id IS NOT NULL`,
    )
    .all(guildId) as EntryRow[];
  return rows.map(mapEntry);
}

export function updateEntryAfk(db: Db, entryId: string, isAfk: boolean): QueueEntry {
  db.prepare(
    "UPDATE queue_entries SET is_afk = ?, updated_at = ? WHERE id = ?",
  ).run(isAfk ? 1 : 0, new Date().toISOString(), entryId);
  return getEntry(db, entryId)!;
}

export function updateEntryStatus(
  db: Db,
  entryId: string,
  status: EntryStatus,
): QueueEntry {
  db.prepare(
    "UPDATE queue_entries SET status = ?, updated_at = ? WHERE id = ?",
  ).run(status, new Date().toISOString(), entryId);
  return getEntry(db, entryId)!;
}

export function updateEntrySortKey(
  db: Db,
  entryId: string,
  sortKey: number,
): void {
  db.prepare(
    "UPDATE queue_entries SET sort_key = ?, updated_at = ? WHERE id = ?",
  ).run(sortKey, new Date().toISOString(), entryId);
}

export function updateOfferStrikes(db: Db, entryId: string, strikes: number): QueueEntry {
  db.prepare(
    "UPDATE queue_entries SET offer_strikes = ?, updated_at = ? WHERE id = ?",
  ).run(strikes, new Date().toISOString(), entryId);
  return getEntry(db, entryId)!;
}

export function updateEntryAcceptedJobs(
  db: Db,
  entryId: string,
  queueIds: string[],
): QueueEntry {
  db.prepare(
    "UPDATE queue_entries SET accepted_job_ids = ?, updated_at = ? WHERE id = ?",
  ).run(JSON.stringify(queueIds), new Date().toISOString(), entryId);
  return getEntry(db, entryId)!;
}

export function updateEntryJobHourPrefs(
  db: Db,
  entryId: string,
  prefs: Record<string, JobHourPref>,
): QueueEntry {
  db.prepare(
    "UPDATE queue_entries SET job_hour_prefs = ?, updated_at = ? WHERE id = ?",
  ).run(JSON.stringify(prefs), new Date().toISOString(), entryId);
  return getEntry(db, entryId)!;
}

export function positionFor(db: Db, entry: QueueEntry): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM queue_entries
       WHERE guild_id = ? AND status = 'waiting' AND sort_key < ?`,
    )
    .get(entry.guildId, entry.sortKey) as { n: number };
  return row.n + 1;
}

export function expireDueEntries(
  db: Db,
  nowIso: string,
  guildId?: string,
): QueueEntry[] {
  const rows = (
    guildId
      ? db.prepare(
          `SELECT * FROM queue_entries
           WHERE guild_id = ? AND status IN ('waiting', 'active')
             AND available_until IS NOT NULL
             AND duration_hours IS NOT NULL
             AND available_until <= ?`,
        ).all(guildId, nowIso)
      : db.prepare(
          `SELECT * FROM queue_entries
           WHERE status IN ('waiting', 'active')
             AND available_until IS NOT NULL
             AND duration_hours IS NOT NULL
             AND available_until <= ?`,
        ).all(nowIso)
  ) as EntryRow[];

  const update = db.prepare(
    "UPDATE queue_entries SET status = 'expired', updated_at = ? WHERE id = ?",
  );
  for (const row of rows) {
    update.run(nowIso, row.id);
  }
  return rows.map((row) => ({ ...mapEntry(row), status: "expired" }));
}

export function insertHistory(
  db: Db,
  row: Omit<QueueHistoryRow, "id" | "createdAt">,
): void {
  db.prepare(
    `INSERT INTO queue_history (
      id, guild_id, queue_id, user_id, actor_id, action, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    row.guildId,
    row.queueId,
    row.userId,
    row.actorId,
    row.action,
    row.details,
    new Date().toISOString(),
  );
}

export function listHistory(
  db: Db,
  guildId: string,
  limit = 20,
): QueueHistoryRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM queue_history
       WHERE guild_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(guildId, limit) as Array<{
    id: string;
    guild_id: string;
    queue_id: string | null;
    user_id: string | null;
    actor_id: string;
    action: string;
    details: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    queueId: row.queue_id,
    userId: row.user_id,
    actorId: row.actor_id,
    action: row.action,
    details: row.details,
    createdAt: row.created_at,
  }));
}
