import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags } from "discord.js";
import { canUpdateEphemeral, replaceEphemeralPrompt } from "../src/utils/reply.js";

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

test("send-jo modal reply deletes the earlier select prompt", async () => {
  let deleted = false;
  let replied = false;
  const interaction = {
    isRepliable: () => true,
    isMessageComponent: () => false,
    isModalSubmit: () => true,
    replied: false,
    deferred: false,
    reply: async () => {
      replied = true;
    },
    message: {
      delete: async () => {
        deleted = true;
      },
    },
  };
  await replaceEphemeralPrompt(interaction as never, { content: "done" });
  assert.equal(replied, true);
  assert.equal(deleted, true);
});
