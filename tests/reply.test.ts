import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags } from "discord.js";
import { canUpdateEphemeral } from "../src/utils/reply.js";

function fakeComponent(options: {
  ephemeral: boolean;
  replied?: boolean;
  deferred?: boolean;
}) {
  return {
    isMessageComponent: () => true,
    replied: options.replied ?? false,
    deferred: options.deferred ?? false,
    message: {
      flags: { has: (flag: unknown) => flag === MessageFlags.Ephemeral && options.ephemeral },
    },
  };
}

test("ephemeral queue buttons update in place instead of stacking", () => {
  assert.equal(canUpdateEphemeral(fakeComponent({ ephemeral: true }) as never), true);
  assert.equal(canUpdateEphemeral(fakeComponent({ ephemeral: false }) as never), false);
  assert.equal(
    canUpdateEphemeral(fakeComponent({ ephemeral: true, replied: true }) as never),
    false,
  );
  assert.equal(
    canUpdateEphemeral({
      isMessageComponent: () => false,
      replied: false,
      deferred: false,
    } as never),
    false,
  );
});
