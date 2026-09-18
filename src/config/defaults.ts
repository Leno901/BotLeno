import { PermissionFlagsBits } from "discord.js";
import type { DefaultQueueTemplate } from "../types.js";

export const APP_NAME = "BotLenoAPP";
export const DEFAULT_TIMEZONE = "Asia/Manila";
export const ABSOLUTE_MAX_HOURS = 24;
export const DEFAULT_MIN_HOURS = 0.5;
export const DEFAULT_CATEGORY_NAME = "BotLenoAPP";
export const DEFAULT_STATUS_CATEGORY_NAME = "queue-status";
/** Flip to true to restore per-user private queue-status channels. */
export const PERSONAL_STATUS_CHANNELS_ENABLED: boolean = false;
export const DEFAULT_PANEL_CHANNEL = "queue-start";
export const LEGACY_PANEL_CHANNEL = "queue-panel";
export const DEFAULT_STATUS_CHANNEL = "queue-dashboard";
export const LEGACY_STATUS_CHANNEL = "queue-status";
export const DEFAULT_ADMIN_CHANNEL = "queue-admin";
export const DEFAULT_LOGS_CHANNEL = "queue-logs";
export const DEFAULT_STAFF_ROLE_NAME = "BotLenoAPP Staff";

export const DEFAULT_QUEUES: readonly DefaultQueueTemplate[] = [
  {
    slug: "pvp",
    name: "PvP",
    emoji: "⚔️",
    description: "Player versus player jobs",
    sortOrder: 1,
  },
  {
    slug: "dungeon",
    name: "Dungeon",
    emoji: "🏰",
    description: "Dungeon runs",
    sortOrder: 2,
  },
  {
    slug: "abyss",
    name: "Abyss",
    emoji: "✨",
    description: "Abyss jobs",
    sortOrder: 3,
  },
  {
    slug: "pet-farm",
    name: "Pet Farm",
    emoji: "🐾",
    description: "Pet farming jobs",
    sortOrder: 4,
  },
  {
    slug: "exploration-leveling",
    name: "Exploration/Leveling",
    emoji: "🧭",
    description: "Exploration and leveling jobs",
    sortOrder: 5,
  },
];

export const BRAND_COLOR = 0x14b8a6;
export const SUCCESS_COLOR = 0x57f287;
export const WARNING_COLOR = 0xfee75c;
export const ERROR_COLOR = 0xed4245;
export const INFO_COLOR = 0x5865f2;

export const JOIN_COOLDOWN_MS = 3000;
export const BUTTON_COOLDOWN_MS = 1000;
export const EXPIRATION_INTERVAL_MS = 15_000;
export const PANEL_DEBOUNCE_MS = 1200;
export const SEND_JO_TIMEOUT_MS = 30_000;
export const SEND_JO_STRIKES_TO_REQUEUE = 2;
export const SEND_JO_OFFER_MAX_LENGTH = 1000;
export const EPHEMERAL_AUTO_DELETE_MS = 5_000;

export const BOT_PERMISSIONS =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageMessages;

export const SETUP_PERMISSIONS = [
  { name: "View Channel", bit: PermissionFlagsBits.ViewChannel },
  { name: "Send Messages", bit: PermissionFlagsBits.SendMessages },
  { name: "Embed Links", bit: PermissionFlagsBits.EmbedLinks },
  { name: "Read Message History", bit: PermissionFlagsBits.ReadMessageHistory },
  { name: "Manage Channels", bit: PermissionFlagsBits.ManageChannels },
  { name: "Manage Roles", bit: PermissionFlagsBits.ManageRoles },
  { name: "Manage Messages", bit: PermissionFlagsBits.ManageMessages },
] as const;

export function inviteUrl(clientId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${BOT_PERMISSIONS.toString()}&scope=bot%20applications.commands`;
}
