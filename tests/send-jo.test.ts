import assert from "node:assert/strict";
import test from "node:test";
import * as store from "../src/database/store.js";
import { isAppError } from "../src/services/errors.js";
import {
  dispatchEntry,
  dispatchNext,
  joinQueue,
  listDutyLine,
  nextReadyForJob,
  pickReadyForJob,
} from "../src/services/queue.js";
import { validateOfferText, offerDeadlineUnix } from "../src/services/send-jo.js";
import { SEND_JO_TIMEOUT_MS } from "../src/config/defaults.js";
import { sendJoOfferEmbed, sendJoOfferResultEmbed } from "../src/ui/embeds.js";
import { withJoArt } from "../src/ui/jo-art.js";
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

test("pickReadyForJob skips on-duty, wrong job, then exhausted", () => {
  const rows = [
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
  assert.equal(pickReadyForJob(rows, ["pvp", "dungeon"])?.entryId, "c");
  assert.equal(pickReadyForJob(rows, ["pvp", "dungeon"], ["c"])?.entryId, "d");
});

test("pickReadyForJob skips READY people whose job hours do not match", () => {
  const rows = [
    {
      entryId: "pet-short",
      status: "ready" as const,
      jobs: [{ id: "pet", hourMin: null, hourMax: 12 }],
    },
    {
      entryId: "pet-long",
      status: "ready" as const,
      jobs: [{ id: "pet", hourMin: 15, hourMax: null }],
    },
  ];

  assert.equal(pickReadyForJob(rows, "pet", [], 15)?.entryId, "pet-long");
  assert.equal(pickReadyForJob(rows, "pet", [], 10)?.entryId, "pet-short");
  assert.equal(pickReadyForJob(rows, "pet", ["pet-long"], 15), null);
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
  const c = joinQueue(db, {
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

  const first = nextReadyForJob(db, GUILD, pvp, [], NOW);
  assert.equal(first?.userId, USER_B);

  const second = nextReadyForJob(db, GUILD, pvp, [b.entry.id], NOW);
  assert.equal(second?.userId, USER_C);

  const exhausted = nextReadyForJob(db, GUILD, pvp, [b.entry.id, c.entry.id, d.entry.id], NOW);
  assert.equal(exhausted, null);
});

test("nextReadyForJob offers to anyone matching any selected J.O.", () => {
  const db = createTestDb();
  store.ensureGuild(db, GUILD);
  const abyss = store.getQueueBySlug(db, GUILD, "abyss")!.id;
  const explo = store.getQueueBySlug(db, GUILD, "exploration-leveling")!.id;

  const firstJoin = joinQueue(db, {
    guildId: GUILD,
    queueId: abyss,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  joinQueue(db, {
    guildId: GUILD,
    queueId: explo,
    userId: USER_B,
    hoursInput: "8",
    now: NOW,
  });

  const first = nextReadyForJob(db, GUILD, [abyss, explo], [], NOW);
  assert.equal(first?.userId, USER_A);

  const second = nextReadyForJob(db, GUILD, [abyss, explo], [firstJoin.entry.id], NOW);
  assert.equal(second?.userId, USER_B);
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

test("dispatchEntry stores the accepted J.O.s, not every queued job", () => {
  const db = createTestDb();
  const { pvp, dungeon } = ids(db);

  const a = joinQueue(db, {
    guildId: GUILD,
    queueIds: [pvp, dungeon],
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });

  dispatchEntry(db, {
    guildId: GUILD,
    entryId: a.entry.id,
    actorId: "staff",
    queueIds: [pvp],
    now: NOW,
  });

  const line = listDutyLine(db, GUILD, NOW);
  assert.deepEqual(
    line.onDuty[0]?.acceptedJobs?.map((job) => job.id),
    [pvp],
  );
  assert.equal(line.onDuty[0]?.jobs.length, 2);
});

test("dispatchEntry accepts the overlapping J.O.s when several were offered", () => {
  const db = createTestDb();
  store.ensureGuild(db, GUILD);
  const abyss = store.getQueueBySlug(db, GUILD, "abyss")!.id;
  const explo = store.getQueueBySlug(db, GUILD, "exploration-leveling")!.id;

  const a = joinQueue(db, {
    guildId: GUILD,
    queueId: abyss,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });

  dispatchEntry(db, {
    guildId: GUILD,
    entryId: a.entry.id,
    actorId: "staff",
    queueIds: [abyss, explo],
    now: NOW,
  });

  const line = listDutyLine(db, GUILD, NOW);
  assert.deepEqual(
    line.onDuty[0]?.acceptedJobs?.map((job) => job.id),
    [abyss],
  );
});

test("dispatchEntry rejects on-duty users", () => {
  const db = createTestDb();
  const { pvp } = ids(db);

  joinQueue(db, {
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

test("J.O. offer deadline is 20 seconds from send time", () => {
  assert.equal(SEND_JO_TIMEOUT_MS, 20_000);
  const now = 1_000_000_000_000;
  assert.equal(offerDeadlineUnix(now), Math.floor((now + 20_000) / 1000));
  const embed = sendJoOfferEmbed("PvP", "need a carry", offerDeadlineUnix(now));
  assert.match(embed.data.description ?? "", /<t:\d+:R>/);
  assert.match(embed.data.description ?? "", /<t:\d+:T>/);
});

test("J.O. offer DM result cards keep the offer text", () => {
  const accepted = sendJoOfferResultEmbed("Abyss", "a", "accepted");
  assert.equal(accepted.data.title, "Abyss J.O. accepted");
  assert.match(accepted.data.description ?? "", /^a\n\n/);
  assert.match(accepted.data.description ?? "", /ON DUTY/);

  const declined = sendJoOfferResultEmbed("Abyss", "a", "declined");
  assert.equal(declined.data.title, "Abyss J.O. declined");
  assert.match(declined.data.description ?? "", /stay in line/);

  const expired = sendJoOfferResultEmbed("Abyss", "a", "timeout");
  assert.equal(expired.data.title, "Abyss J.O. skipped");
  assert.match(expired.data.description ?? "", /skipped/);
});

test("J.O. offer cards attach Discord PNG thumbnails", () => {
  const offer = withJoArt(sendJoOfferEmbed("Abyss", "a", 1_700_000_000), "offer");
  assert.equal(offer.files.length, 1);
  assert.equal(offer.embeds[0]?.data.thumbnail?.url, "attachment://jo-offer.png");

  const accepted = withJoArt(sendJoOfferResultEmbed("Abyss", "a", "accepted"), "accepted");
  assert.equal(accepted.embeds[0]?.data.thumbnail?.url, "attachment://jo-accepted.png");
});
