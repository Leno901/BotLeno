import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags } from "discord.js";
import { shouldRepostPanel, upsertDutyLineMessage } from "../src/services/display.js";
import { isTransientDiscordError, withTransientRetry } from "../src/services/discord-retry.js";
import type { DutyLine } from "../src/types.js";

const LINE: DutyLine = {
  rows: [
    {
      entryId: "e1",
      userId: "user-1",
      position: 1,
      status: "afk",
      jobs: [{ id: "q1", slug: "pvp", name: "PvP", emoji: "⚔️" }],
      durationHours: null,
      availableFrom: "2026-09-17T00:00:00.000Z",
      availableUntil: null,
    },
  ],
  inLine: 1,
  afkCount: 1,
  onDutyCount: 0,
  onDuty: [],
  jobCount: 1,
};

function fakeGuild() {
  return {
    members: {
      cache: { get: () => null },
      fetch: async () => null,
    },
    client: {
      users: {
        cache: { get: () => null },
        fetch: async () => ({ username: "LENO", globalName: "LENO" }),
      },
    },
  };
}

function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  error.name = "HTTPError";
  return error;
}

test("treats Discord 502/503/504 as transient", () => {
  assert.equal(isTransientDiscordError(httpError(503, "Service Unavailable")), true);
  assert.equal(isTransientDiscordError(httpError(404, "Unknown")), false);
});

test("retries a transient Discord failure then succeeds", async () => {
  let attempts = 0;
  const value = await withTransientRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw httpError(503, "Service Unavailable");
      return "ok";
    },
    { attempts: 3, delayMs: 0 },
  );
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
});

test("does not delete the old dashboard if posting the new one fails", async () => {
  let deleted = false;
  const existing = {
    id: "old-msg",
    flags: { has: (flag: number) => flag === MessageFlags.IsComponentsV2 },
    delete: async () => {
      deleted = true;
    },
    edit: async () => {
      throw new Error("should not edit a Components V2 dashboard");
    },
  };
  const channel = {
    guild: fakeGuild(),
    messages: { fetch: async () => existing },
    send: async () => {
      throw httpError(503, "Service Unavailable");
    },
  };

  await assert.rejects(
    () =>
      upsertDutyLineMessage(
        channel as never,
        "old-msg",
        LINE,
        "Asia/Manila",
      ),
    /Service Unavailable/,
  );
  assert.equal(deleted, false);
});

test("queue-start panel is reposted when it is no longer the last message", () => {
  assert.equal(shouldRepostPanel("panel-1", "panel-1"), false);
  assert.equal(shouldRepostPanel("panel-1", "newer-msg"), true);
  assert.equal(shouldRepostPanel(null, "newer-msg"), false);
});
