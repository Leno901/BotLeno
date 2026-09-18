import type { JobHourPref } from "../types.js";
import { isUuid } from "./ids.js";

export interface AdminSession {
  queueId?: string;
  entryId?: string;
}

export interface PendingJoin {
  queueIds: string[];
  jobHourPrefs: Record<string, JobHourPref>;
  at: number;
}

interface PendingSendJo {
  queueIds: string[];
  at: number;
}

const sessions = new Map<string, AdminSession>();
const pendingJoins = new Map<string, PendingJoin>();
const pendingSendJos = new Map<string, PendingSendJo>();

function key(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export function getAdminSession(guildId: string, userId: string): AdminSession {
  return sessions.get(key(guildId, userId)) ?? {};
}

export function patchAdminSession(
  guildId: string,
  userId: string,
  patch: AdminSession,
): AdminSession {
  const next = { ...getAdminSession(guildId, userId), ...patch };
  if (next.queueId && !isUuid(next.queueId)) delete next.queueId;
  if (next.entryId && !isUuid(next.entryId)) delete next.entryId;
  sessions.set(key(guildId, userId), next);
  return next;
}

export function setPendingJoin(
  guildId: string,
  userId: string,
  queueIds: string[],
): void {
  pendingJoins.set(key(guildId, userId), {
    queueIds,
    jobHourPrefs: {},
    at: Date.now(),
  });
}

function livePendingJoin(guildId: string, userId: string): PendingJoin | null {
  const pending = pendingJoins.get(key(guildId, userId));
  if (!pending) return null;
  if (Date.now() - pending.at > 15 * 60 * 1000) {
    pendingJoins.delete(key(guildId, userId));
    return null;
  }
  return pending;
}

export function peekPendingJoin(guildId: string, userId: string): PendingJoin | null {
  return livePendingJoin(guildId, userId);
}

export function patchPendingJoinHours(
  guildId: string,
  userId: string,
  queueId: string,
  pref: JobHourPref,
): PendingJoin | null {
  const pending = livePendingJoin(guildId, userId);
  if (!pending || !pending.queueIds.includes(queueId)) return null;
  pending.jobHourPrefs[queueId] = pref;
  pending.at = Date.now();
  return pending;
}

export function takePendingJoin(guildId: string, userId: string): PendingJoin | null {
  const pending = livePendingJoin(guildId, userId);
  pendingJoins.delete(key(guildId, userId));
  return pending;
}

export function setPendingSendJo(
  guildId: string,
  userId: string,
  queueIds: string[],
): void {
  pendingSendJos.set(key(guildId, userId), { queueIds, at: Date.now() });
}

export function takePendingSendJo(
  guildId: string,
  userId: string,
): string[] | null {
  const pending = pendingSendJos.get(key(guildId, userId));
  pendingSendJos.delete(key(guildId, userId));
  if (!pending) return null;
  if (Date.now() - pending.at > 15 * 60 * 1000) return null;
  const queueIds = pending.queueIds.filter((id) => isUuid(id));
  return queueIds.length > 0 ? queueIds : null;
}
