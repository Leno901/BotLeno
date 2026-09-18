import assert from "node:assert/strict";
import test from "node:test";
import { PermissionFlagsBits } from "discord.js";
import {
  canManageTargetRole,
  isGuildManager,
  memberHasStaffAccess,
  missingPermissionNames,
} from "../src/services/permissions.js";

test("lists every missing setup permission by name", () => {
  const missing = missingPermissionNames(0n);
  assert.ok(missing.includes("Manage Channels"));
  assert.ok(missing.includes("Manage Roles"));
  assert.ok(missing.includes("Send Messages"));
});

test("returns no missing permissions when the bot has the full set", () => {
  const have =
    PermissionFlagsBits.ViewChannel |
    PermissionFlagsBits.SendMessages |
    PermissionFlagsBits.EmbedLinks |
    PermissionFlagsBits.ReadMessageHistory |
    PermissionFlagsBits.ManageChannels |
    PermissionFlagsBits.ManageRoles |
    PermissionFlagsBits.ManageMessages;
  assert.deepEqual(missingPermissionNames(have), []);
});

test("role hierarchy requires the bot role to sit strictly above the target", () => {
  assert.equal(canManageTargetRole(5, 4), true);
  assert.equal(canManageTargetRole(4, 4), false);
  assert.equal(canManageTargetRole(3, 8), false);
});

test("staff access is granted by Manage Guild or the configured staff role", () => {
  assert.equal(
    memberHasStaffAccess({
      permissions: PermissionFlagsBits.ManageGuild,
      memberRoleIds: [],
      staffRoleId: "staff",
    }),
    true,
  );
  assert.equal(
    memberHasStaffAccess({
      permissions: 0n,
      memberRoleIds: ["staff"],
      staffRoleId: "staff",
    }),
    true,
  );
  assert.equal(
    memberHasStaffAccess({
      permissions: 0n,
      memberRoleIds: ["other"],
      staffRoleId: "staff",
    }),
    false,
  );
});

test("guild managers are detected from the Manage Guild bit", () => {
  assert.equal(isGuildManager(PermissionFlagsBits.ManageGuild), true);
  assert.equal(isGuildManager(PermissionFlagsBits.SendMessages), false);
});
