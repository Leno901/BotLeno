import type { Client, GuildMember, PermissionResolvable, Role } from "discord.js";
import { DiscordAPIError } from "discord.js";
import { PANEL_DEBOUNCE_MS } from "./config/defaults.js";
import type { Env } from "./config/env.js";
import type { Db } from "./database/client.js";
import type { Logger } from "./logger.js";
import type { CooldownTracker } from "./services/cooldown.js";

export interface AppContext {
  db: Db;
  env: Env;
  logger: Logger;
  cooldown: CooldownTracker;
  client: Client;
  display: DisplaySync;
}

export interface DisplaySync {
  schedule(guildId: string): void;
  stop(): void;
}

export function createDisplaySync(
  refresh: (guildId: string) => Promise<void>,
  debounceMs = PANEL_DEBOUNCE_MS,
): DisplaySync {
  const timers = new Map<string, NodeJS.Timeout>();

  return {
    schedule(guildId: string) {
      const existing = timers.get(guildId);
      if (existing) clearTimeout(existing);
      timers.set(
        guildId,
        setTimeout(() => {
          timers.delete(guildId);
          void refresh(guildId);
        }, debounceMs),
      );
    },
    stop() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

export function memberPermissionBits(member: GuildMember): bigint {
  return member.permissions.bitfield;
}

export function memberRoleIds(member: GuildMember): string[] {
  return [...member.roles.cache.keys()];
}

export function botCanManageRole(botMember: GuildMember, role: Role): boolean {
  return botMember.roles.highest.comparePositionTo(role) > 0;
}

export function hasPerm(
  member: GuildMember,
  permission: PermissionResolvable,
): boolean {
  return member.permissions.has(permission);
}

export function discordErrorCode(error: unknown): number | null {
  if (error instanceof DiscordAPIError) return error.status ? Number(error.code) : Number(error.code);
  return null;
}

export function isUnknownInteraction(error: unknown): boolean {
  return discordErrorCode(error) === 10062 || discordErrorCode(error) === 40060;
}
