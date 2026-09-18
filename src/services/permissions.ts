import { PermissionFlagsBits } from "discord.js";
import { SETUP_PERMISSIONS } from "../config/defaults.js";

export function missingPermissionNames(have: bigint): string[] {
  return SETUP_PERMISSIONS.filter((permission) => (have & permission.bit) !== permission.bit).map(
    (permission) => permission.name,
  );
}

export function canManageTargetRole(
  botHighestPosition: number,
  targetRolePosition: number,
): boolean {
  return botHighestPosition > targetRolePosition;
}

export function isGuildManager(permissions: bigint): boolean {
  return (permissions & PermissionFlagsBits.ManageGuild) === PermissionFlagsBits.ManageGuild;
}

export function memberHasStaffAccess(options: {
  permissions: bigint;
  memberRoleIds: readonly string[];
  staffRoleId: string | null;
}): boolean {
  if (isGuildManager(options.permissions)) return true;
  if (!options.staffRoleId) return false;
  return options.memberRoleIds.includes(options.staffRoleId);
}
