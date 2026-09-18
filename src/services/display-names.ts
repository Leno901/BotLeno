import type { Guild, User } from "discord.js";
import type { DutyLine, DutyLineRow } from "../types.js";
import { pickDiscordDisplayName, sanitizeDisplayName } from "../ui/embeds.js";

export async function resolveGuildDisplayName(
  guild: Guild,
  userId: string,
): Promise<string> {
  const member =
    guild.members.cache.get(userId) ??
    (await guild.members.fetch(userId).catch(() => null));
  let user: User | null = member?.user ?? guild.client.users.cache.get(userId) ?? null;
  if (!accountName(user)) {
    user = await guild.client.users.fetch(userId).catch(() => null);
  }
  return pickDiscordDisplayName({
    displayName: member?.displayName,
    nickname: member?.nickname,
    globalName: user?.globalName ?? member?.user.globalName,
    username: user?.username ?? member?.user.username,
    userId,
  });
}

export async function resolveDisplayNames(
  guild: Guild,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await Promise.all(
    [...new Set(userIds)].map(async (id) => {
      names.set(id, await resolveGuildDisplayName(guild, id));
    }),
  );
  return names;
}

export function hydrateDisplayNames(
  line: DutyLine,
  names: Map<string, string>,
): DutyLine {
  const hydrate = (row: DutyLineRow): DutyLineRow => ({
    ...row,
    displayName: names.get(row.userId) ?? row.displayName,
  });
  return {
    ...line,
    rows: line.rows.map(hydrate),
    onDuty: line.onDuty.map(hydrate),
  };
}

function accountName(user: User | null): boolean {
  return Boolean(
    sanitizeDisplayName(user?.globalName) || sanitizeDisplayName(user?.username),
  );
}
