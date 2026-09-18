import {
  PermissionFlagsBits,
  type AutocompleteInteraction,
  type BaseInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { AppContext } from "../app-context.js";
import * as store from "../database/store.js";
import { memberHasStaffAccess } from "../services/permissions.js";
import { AppError } from "../services/errors.js";
import { BUTTON_COOLDOWN_MS, JOIN_COOLDOWN_MS } from "../config/defaults.js";

export function requireGuildId(interaction: { guildId: string | null }): string {
  if (!interaction.guildId) {
    throw new AppError("Use this in a Discord server.", "GUILD_ONLY", "error");
  }
  return interaction.guildId;
}

export function staffMember(interaction: BaseInteraction, ctx: AppContext): GuildMember {
  if (!interaction.inCachedGuild() || !interaction.member) {
    throw new AppError("Could not resolve your member profile.", "FORBIDDEN", "error");
  }
  const guildId = interaction.guildId;
  const member = interaction.member;
  const guild = store.ensureGuild(ctx.db, guildId);
  if (
    !memberHasStaffAccess({
      permissions: member.permissions.bitfield,
      memberRoleIds: [...member.roles.cache.keys()],
      staffRoleId: guild.staffRoleId,
    })
  ) {
    throw new AppError("This action is limited to queue staff.", "FORBIDDEN", "error");
  }
  return member;
}

export function requireManageGuild(member: GuildMember | null): void {
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    throw new AppError(
      "You need **Manage Server** for this command.",
      "FORBIDDEN",
      "error",
    );
  }
}

export function hitCooldown(
  ctx: AppContext,
  userId: string,
  action: string,
  windowMs: number,
): void {
  const remaining = ctx.cooldown.hit(`${userId}:${action}`, windowMs);
  if (remaining > 0) {
    const seconds = Math.ceil(remaining / 1000);
    throw new AppError(
      `Please wait ${seconds}s before doing that again.`,
      "COOLDOWN",
    );
  }
}

export function joinCooldown(ctx: AppContext, userId: string): void {
  hitCooldown(ctx, userId, "join", JOIN_COOLDOWN_MS);
}

export function buttonCooldown(ctx: AppContext, userId: string): void {
  hitCooldown(ctx, userId, "button", BUTTON_COOLDOWN_MS);
}

export type AnyUserInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction
  | AutocompleteInteraction
  | MessageComponentInteraction;
