export type QueueStatus = "open" | "paused" | "closed";

export type EntryStatus =
  | "waiting"
  | "active"
  | "completed"
  | "cancelled"
  | "expired"
  | "skipped";

export interface GuildConfig {
  id: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface Queue {
  id: string;
  guildId: string;
  slug: string;
  name: string;
  emoji: string;
  description: string;
  minHours: number;
  maxHours: number;
  maxSize: number | null;
  status: QueueStatus;
  sortOrder: number;
  allowLeave: boolean;
  entriesExpire: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QueueEntry {
  id: string;
  guildId: string;
  queueId: string;
  userId: string;
  sortKey: number;
  durationHours: number | null;
  availableUntil: string | null;
  status: EntryStatus;
  isAfk: boolean;
  statusChannelId: string | null;
  statusMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueHistoryRow {
  id: string;
  guildId: string;
  queueId: string | null;
  userId: string | null;
  actorId: string;
  action: string;
  details: string | null;
  createdAt: string;
}

export interface QueueWithCount extends Queue {
  waitingCount: number;
}

export interface DashboardEntry {
  userId: string;
  position: number;
  durationHours: number | null;
  availableUntil: string | null;
}

export interface DashboardQueue extends QueueWithCount {
  entries: DashboardEntry[];
}

export type DutyStatus = "ready" | "afk" | "on_duty";

export interface DutyJob {
  id: string;
  slug: string;
  name: string;
  emoji: string;
}

export interface DutyLineRow {
  entryId: string;
  userId: string;
  position: number;
  status: DutyStatus;
  jobs: DutyJob[];
  durationHours: number | null;
  availableFrom: string;
  availableUntil: string | null;
  displayName?: string;
}

export interface DutyLine {
  rows: DutyLineRow[];
  inLine: number;
  afkCount: number;
  onDutyCount: number;
  onDuty: DutyLineRow[];
  jobCount: number;
}

export interface UserQueueView {
  entry: QueueEntry;
  queue: Queue;
  jobs: Queue[];
  position: number;
  peopleAhead: number;
}

export interface DefaultQueueTemplate {
  slug: string;
  name: string;
  emoji: string;
  description: string;
  sortOrder: number;
}
