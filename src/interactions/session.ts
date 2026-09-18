import { isUuid } from "./ids.js";

export interface AdminSession {
  queueId?: string;
  entryId?: string;
}

interface PendingJoin {
  queueIds: string[];
  at: number;
}

interface PendingSendJo {
  queueId: string;
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
  pendingJoins.set(key(guildId, userId), { queueIds, at: Date.now() });
}

export function takePendingJoin(guildId: string, userId: string): string[] | null {
  const pending = pendingJoins.get(key(guildId, userId));
  pendingJoins.delete(key(guildId, userId));
  if (!pending) return null;
  if (Date.now() - pending.at > 15 * 60 * 1000) return null;
  return pending.queueIds;
}

export function setPendingSendJo(
  guildId: string,
  userId: string,
  queueId: string,
): void {
  pendingSendJos.set(key(guildId, userId), { queueId, at: Date.now() });
}

export function takePendingSendJo(
  guildId: string,
  userId: string,
): string | null {
  const pending = pendingSendJos.get(key(guildId, userId));
  pendingSendJos.delete(key(guildId, userId));
  if (!pending) return null;
  if (Date.now() - pending.at > 15 * 60 * 1000) return null;
  return isUuid(pending.queueId) ? pending.queueId : null;
}
