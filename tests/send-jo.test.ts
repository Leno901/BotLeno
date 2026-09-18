import assert from "node:assert/strict";
import test from "node:test";
import * as store from "../src/database/store.js";
import { isAppError } from "../src/services/errors.js";
import {
  dispatchEntry,
  dispatchNext,
  joinQueue,
  nextReadyForJob,
  pickReadyForJob,
  toggleAfk,
} from "../src/services/queue.js";
import { validateOfferText } from "../src/services/send-jo.js";
import { createTestDb } from "./helpers.js";

const GUILD = "guild-1";
const USER_A = "user-a";
const USER_B = "user-b";
const USER_C = "user-c";
const USER_D = "user-d";
const NOW = new Date("2026-09-17T00:00:00.000Z");

function ids(db: ReturnType<typeof createTestDb>) {
  store.ensureGuild(db, GUILD);
  return {
    pvp: store.getQueueBySlug(db, GUILD, "pvp")!.id,
    dungeon: store.getQueueBySlug(db, GUILD, "dungeon")!.id,
  };
}

test("pickReadyForJob skips AFK, on-duty, wrong job, then exhausted", () => {
  const rows = [
    { entryId: "a", status: "afk" as const, jobs: [{ id: "pvp" }] },
    { entryId: "b", status: "on_duty" as const, jobs: [{ id: "pvp" }] },
    { entryId: "c", status: "ready" as const, jobs: [{ id: "dungeon" }] },
    { entryId: "d", status: "ready" as const, jobs: [{ id: "pvp" }] },
    { entryId: "e", status: "ready" as const, jobs: [{ id: "pvp" }] },
  ];

  assert.equal(pickReadyForJob(rows, "pvp")?.entryId, "d");
  assert.equal(pickReadyForJob(rows, "pvp", ["d"])?.entryId, "e");
  assert.equal(pickReadyForJob(rows, "pvp", ["d", "e"]), null);
  assert.equal(pickReadyForJob(rows, "dungeon")?.entryId, "c");
  assert.equal(pickReadyForJob(rows, "abyss"), null);
});

test("nextReadyForJob walks the duty line in order", () => {
  const db = createTestDb();
  const { pvp, dungeon } = ids(db);

  joinQueue(db, {
    guildId: GUILD,
    queueId: dungeon,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  const b = joinQueue(db, {
    guildId: GUILD,
    queueId: pvp,
    userId: USER_B,
    hoursInput: "8",
    now: NOW,
  });
  joinQueue(db, {
    guildId: GUILD,
    queueId: pvp,
    userId: USER_C,
    hoursInput: "8",
    now: NOW,
  });
  const d = joinQueue(db, {
    guildId: GUILD,
    queueId: pvp,
    userId: USER_D,
    hoursInput: "8",
    now: NOW,
  });

  toggleAfk(db, { guildId: GUILD, userId: USER_C, now: NOW });

  const first = nextReadyForJob(db, GUILD, pvp, [], NOW);
  assert.equal(first?.userId, USER_B);

  const second = nextReadyForJob(db, GUILD, pvp, [b.entry.id], NOW);
  assert.equal(second?.userId, USER_D);

  const exhausted = nextReadyForJob(db, GUILD, pvp, [b.entry.id, d.entry.id], NOW);
  assert.equal(exhausted, null);
});

test("dispatchEntry activates a specific READY user, not global #1", () => {
  const db = createTestDb();
  const { pvp } = ids(db);

  const a = joinQueue(db, {
    guildId: GUILD,
    queueId: pvp,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  const b = joinQueue(db, {
    guildId: GUILD,
    queueId: pvp,
    userId: USER_B,
    hoursInput: "8",
    now: NOW,
  });

  const dispatched = dispatchEntry(db, {
    guildId: GUILD,
    entryId: b.entry.id,
    actorId: "staff",
    queueId: pvp,
    now: NOW,
  });
  assert.equal(dispatched.entry.userId, USER_B);
  assert.equal(dispatched.entry.status, "active");

  const stillFirst = store.getEntry(db, a.entry.id);
  assert.equal(stillFirst?.status, "waiting");
  assert.equal(stillFirst?.isAfk, false);

  assert.equal(nextReadyForJob(db, GUILD, pvp, [], NOW)?.userId, USER_A);
});

test("dispatchEntry rejects AFK and on-duty users", () => {
  const db = createTestDb();
  const { pvp } = ids(db);

  const a = joinQueue(db, {
    guildId: GUILD,
    queueId: pvp,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  joinQueue(db, {
    guildId: GUILD,
    queueId: pvp,
    userId: USER_B,
    hoursInput: "8",
    now: NOW,
  });

  toggleAfk(db, { guildId: GUILD, userId: USER_A, now: NOW });
  assert.throws(
    () =>
      dispatchEntry(db, {
        guildId: GUILD,
        entryId: a.entry.id,
        actorId: "staff",
        queueId: pvp,
        now: NOW,
      }),
    (error: unknown) => isAppError(error) && error.code === "NOT_READY",
  );

  const onDuty = dispatchNext(db, { guildId: GUILD, actorId: "staff", now: NOW });
  assert.throws(
    () =>
      dispatchEntry(db, {
        guildId: GUILD,
        entryId: onDuty.entry.id,
        actorId: "staff",
        queueId: pvp,
        now: NOW,
      }),
    (error: unknown) => isAppError(error) && error.code === "NOT_READY",
  );
});

test("validateOfferText trims and rejects empty or oversized text", () => {
  assert.equal(validateOfferText("  need a PvP carry  "), "need a PvP carry");
  assert.throws(
    () => validateOfferText("   "),
    (error: unknown) => isAppError(error) && error.code === "INVALID_OFFER",
  );
  assert.throws(
    () => validateOfferText("x".repeat(1001)),
    (error: unknown) => isAppError(error) && error.code === "INVALID_OFFER",
  );
});
