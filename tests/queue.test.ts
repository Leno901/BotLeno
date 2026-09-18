import assert from "node:assert/strict";
import test from "node:test";
import { PermissionFlagsBits, OverwriteType } from "discord.js";
import { migrate } from "../src/database/client.js";
import { MIGRATIONS } from "../src/database/migrations.js";
import * as store from "../src/database/store.js";
import { isAppError } from "../src/services/errors.js";
import {
  clearAllQueues,
  clearQueue,
  completeEntry,
  expireDue,
  getUserQueueStatus,
  joinQueue,
  leaveQueue,
  dispatchNext,
  listDutyLine,
  nextReadyForJob,
  listQueueMembers,
  moveEntry,
  recordOfferPass,
  setQueueStatus,
  skipEntry,
  toggleAfk,
  pickReadyForJob,
} from "../src/services/queue.js";
import { formatDashboardEntry, formatDutyLineTable, formatJobList, formatJobTable, formatOnDutyBody, formatQueuePanelLines, joinedEmbed, pickDiscordDisplayName, queuePanelEmbed } from "../src/ui/embeds.js";
import { buildQueueEmbed, dutyLineDashboardPayload, formatEntry } from "../src/ui/dashboard.js";
import { joinHoursModal, userQueueButtons } from "../src/ui/components.js";
import { personalStatusChannelName, isPersonalStatusChannelName, personalStatusOverwrites, statusCategoryOverwrites } from "../src/services/user-status-channel.js";
import { PERSONAL_STATUS_CHANNELS_ENABLED } from "../src/config/defaults.js";
import { createTestDb } from "./helpers.js";
import { Ids } from "../src/interactions/ids.js";

const GUILD = "guild-1";
const USER_A = "user-a";
const USER_B = "user-b";
const USER_C = "user-c";
const NOW = new Date("2026-09-17T00:00:00.000Z");

function pvpId(db: ReturnType<typeof createTestDb>): string {
  store.ensureGuild(db, GUILD);
  return store.getQueueBySlug(db, GUILD, "pvp")!.id;
}

test("assigns sequential positions as users join", () => {
  const db = createTestDb();
  const queueId = pvpId(db);

  const a = joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  const b = joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_B,
    hoursInput: "4",
    now: NOW,
  });

  assert.equal(a.position, 1);
  assert.equal(b.position, 2);
  assert.equal(b.peopleAhead, 1);
  assert.equal(a.entry.availableUntil, "2026-09-17T08:00:00.000Z");
});

test("rejects a duplicate join in the same queue", () => {
  const db = createTestDb();
  const queueId = pvpId(db);
  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });

  assert.throws(
    () =>
      joinQueue(db, {
        guildId: GUILD,
        queueId,
        userId: USER_A,
        hoursInput: "2",
        now: NOW,
      }),
    (error: unknown) =>
      isAppError(error) &&
      error.code === "ALREADY_QUEUED" &&
      /already #1 in the duty line/.test(error.message),
  );
});

test("recalculates position after the person ahead leaves", () => {
  const db = createTestDb();
  const queueId = pvpId(db);
  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_B,
    hoursInput: "8",
    now: NOW,
  });

  leaveQueue(db, { guildId: GUILD, userId: USER_A, now: NOW });
  const status = getUserQueueStatus(db, GUILD, USER_B, NOW);
  assert.equal(status?.position, 1);
  assert.equal(status?.peopleAhead, 0);
});

test("keeps positions unique when many users join in one burst", () => {
  const db = createTestDb();
  const queueId = pvpId(db);
  const users = Array.from({ length: 25 }, (_, index) => `burst-${index}`);
  const positions = users.map(
    (userId) =>
      joinQueue(db, {
        guildId: GUILD,
        queueId,
        userId,
        hoursInput: "1",
        now: NOW,
      }).position,
  );

  assert.deepEqual(positions, users.map((_, index) => index + 1));
  assert.equal(new Set(positions).size, positions.length);
});

test("blocks joining a paused or closed queue", () => {
  const db = createTestDb();
  const queueId = pvpId(db);
  setQueueStatus(db, {
    guildId: GUILD,
    queueId,
    status: "paused",
    actorId: "staff",
  });
  assert.throws(
    () =>
      joinQueue(db, {
        guildId: GUILD,
        queueId,
        userId: USER_A,
        hoursInput: "8",
        now: NOW,
      }),
    (error: unknown) => isAppError(error) && error.code === "QUEUE_PAUSED",
  );

  setQueueStatus(db, {
    guildId: GUILD,
    queueId,
    status: "closed",
    actorId: "staff",
  });
  assert.throws(
    () =>
      joinQueue(db, {
        guildId: GUILD,
        queueId,
        userId: USER_A,
        hoursInput: "8",
        now: NOW,
      }),
    (error: unknown) => isAppError(error) && error.code === "QUEUE_CLOSED",
  );
});

test("defaults to one active queue entry per user", () => {
  const db = createTestDb();
  store.ensureGuild(db, GUILD);
  const pvp = store.getQueueBySlug(db, GUILD, "pvp")!.id;
  const dungeon = store.getQueueBySlug(db, GUILD, "dungeon")!.id;

  joinQueue(db, {
    guildId: GUILD,
    queueId: pvp,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  assert.throws(
    () =>
      joinQueue(db, {
        guildId: GUILD,
        queueId: dungeon,
        userId: USER_A,
        hoursInput: "8",
        now: NOW,
      }),
    (error: unknown) => isAppError(error) && error.code === "ALREADY_QUEUED",
  );
});

test("allows multiple queues when the guild setting is enabled", () => {
  const db = createTestDb();
  store.ensureGuild(db, GUILD);
  store.updateGuild(db, GUILD, { allowMultipleQueues: true });
  const pvp = store.getQueueBySlug(db, GUILD, "pvp")!.id;
  const dungeon = store.getQueueBySlug(db, GUILD, "dungeon")!.id;

  joinQueue(db, {
    guildId: GUILD,
    queueId: pvp,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  const second = joinQueue(db, {
    guildId: GUILD,
    queueId: dungeon,
    userId: USER_A,
    hoursInput: "3",
    now: NOW,
  });
  assert.equal(second.queue.slug, "dungeon");
});

test("expires waiting entries from the stored timestamp", () => {
  const db = createTestDb();
  const queueId = pvpId(db);
  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });

  const expired = expireDue(db, new Date("2026-09-17T08:00:00.000Z"), GUILD);
  assert.equal(expired.length, 1);
  assert.equal(expired[0]?.userId, USER_A);
  assert.equal(getUserQueueStatus(db, GUILD, USER_A, new Date("2026-09-17T08:00:01.000Z")), null);
});

test("skip, complete, clear, and move keep a consistent waiting order", () => {
  const db = createTestDb();
  const queueId = pvpId(db);
  const a = joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  const b = joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_B,
    hoursInput: "8",
    now: NOW,
  });
  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_C,
    hoursInput: "8",
    now: NOW,
  });

  skipEntry(db, { guildId: GUILD, entryId: a.entry.id, actorId: "staff", now: NOW });
  completeEntry(db, {
    guildId: GUILD,
    entryId: b.entry.id,
    actorId: "staff",
    now: NOW,
  });

  const after = listQueueMembers(db, GUILD, queueId, NOW);
  assert.equal(after.entries.length, 1);
  assert.equal(after.entries[0]?.userId, USER_C);
  assert.equal(after.entries[0]?.position, 1);

  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_A,
    hoursInput: "2",
    now: NOW,
  });
  const members = listQueueMembers(db, GUILD, queueId, NOW);
  const last = members.entries[1]!;
  moveEntry(db, {
    guildId: GUILD,
    entryId: last.id,
    newPosition: 1,
    actorId: "staff",
    now: NOW,
  });
  const moved = listQueueMembers(db, GUILD, queueId, NOW);
  assert.equal(moved.entries[0]?.userId, USER_A);
  assert.equal(moved.entries[1]?.userId, USER_C);

  const cleared = clearQueue(db, {
    guildId: GUILD,
    queueId,
    actorId: "staff",
    now: NOW,
  });
  assert.equal(cleared.cleared, 2);
  assert.equal(listQueueMembers(db, GUILD, queueId, NOW).entries.length, 0);
});

test("clearAllQueues removes waiting users from every queue", () => {
  const db = createTestDb();
  const pvp = pvpId(db);
  const dungeon = store.getQueueBySlug(db, GUILD, "dungeon")!.id;

  joinQueue(db, {
    guildId: GUILD,
    queueId: pvp,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  joinQueue(db, {
    guildId: GUILD,
    queueId: dungeon,
    userId: USER_B,
    hoursInput: "8",
    now: NOW,
  });

  const result = clearAllQueues(db, { guildId: GUILD, actorId: "staff", now: NOW });
  assert.equal(result.cleared, 2);
  assert.equal(listQueueMembers(db, GUILD, pvp, NOW).entries.length, 0);
  assert.equal(listQueueMembers(db, GUILD, dungeon, NOW).entries.length, 0);
});

test("rejects hours above 24 and enforces queue max size", () => {
  const db = createTestDb();
  const queueId = pvpId(db);
  store.updateQueue(db, queueId, { maxSize: 1 });

  assert.throws(
    () =>
      joinQueue(db, {
        guildId: GUILD,
        queueId,
        userId: USER_A,
        hoursInput: "25",
        now: NOW,
      }),
    (error: unknown) => isAppError(error) && error.code === "INVALID_HOURS",
  );

  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  assert.throws(
    () =>
      joinQueue(db, {
        guildId: GUILD,
        queueId,
        userId: USER_B,
        hoursInput: "8",
        now: NOW,
      }),
    (error: unknown) => isAppError(error) && error.code === "QUEUE_FULL",
  );
});

test("schema migrations can be applied twice without duplicating tables", () => {
  const db = createTestDb();
  migrate(db);
  migrate(db);
  const row = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as {
    n: number;
  };
  assert.equal(row.n, MIGRATIONS.length);
  store.ensureGuild(db, GUILD);
  store.ensureGuild(db, GUILD);
  assert.equal(store.listQueues(db, GUILD).length, 5);
  assert.ok(store.getQueueBySlug(db, GUILD, "exploration-leveling"));
});

test("live duty line shows one row per person with jobs, hours, and clock range", () => {
  const db = createTestDb();
  store.ensureGuild(db, GUILD);
  const pvp = store.getQueueBySlug(db, GUILD, "pvp")!.id;
  const dungeon = store.getQueueBySlug(db, GUILD, "dungeon")!.id;

  joinQueue(db, {
    guildId: GUILD,
    queueIds: [pvp, dungeon],
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });

  const line = listDutyLine(db, GUILD, NOW);
  assert.equal(line.inLine, 1);
  assert.equal(line.rows[0]?.userId, USER_A);
  assert.equal(line.rows[0]?.status, "ready");
  assert.deepEqual(
    line.rows[0]?.jobs.map((job) => job.name),
    ["PvP", "Dungeon"],
  );
  assert.equal(line.rows[0]?.durationHours, 8);
  assert.ok(store.getQueueBySlug(db, GUILD, "exploration-leveling"));
});

test("selecting every J.O. is labeled All jobs", () => {
  const db = createTestDb();
  store.ensureGuild(db, GUILD);
  const ids = store.listQueues(db, GUILD).map((queue) => queue.id);
  joinQueue(db, {
    guildId: GUILD,
    queueIds: ids,
    userId: USER_A,
    hoursInput: "3",
    now: NOW,
  });
  const line = listDutyLine(db, GUILD, NOW);
  assert.equal(formatJobList(line.rows[0]!.jobs, line.jobCount), "All jobs");
  const table = formatDutyLineTable(line, "Asia/Manila");
  assert.match(table, /Jobs: All jobs/);
  assert.equal(table.includes("PvP"), false);
});

test("dashboard queue rows are stacked cards with small text", () => {
  const line = formatDashboardEntry(
    {
      entryId: "e1",
      userId: "user-a",
      displayName: "Alex",
      position: 1,
      status: "ready",
      jobs: [
        { id: "q1", slug: "pvp", name: "PvP", emoji: "⚔️" },
        { id: "q2", slug: "abyss", name: "Abyss", emoji: "✨" },
        { id: "q3", slug: "exploration-leveling", name: "Exploration/Leveling", emoji: "🧭" },
        { id: "q4", slug: "dungeon", name: "Dungeon", emoji: "🏰" },
      ],
      durationHours: 2.5,
      availableFrom: "2026-09-17T00:00:00.000Z",
      availableUntil: "2026-09-17T02:30:00.000Z",
    },
    "Asia/Manila",
    5,
    new Date("2026-09-17T00:12:00.000Z"),
  );
  assert.equal(
    line,
    [
      "-# 1 Alex",
      "-#   Status: 🟢 In line",
      "-#   Jobs: PvP, Abyss, Exploration, Dungeon",
      "-#   Hours: 2.5h · Wait: 12m",
    ].join("\n"),
  );

  const table = formatDutyLineTable(
    {
      rows: [
        {
          entryId: "e1",
          userId: "user-a",
          displayName: "Alex",
          position: 1,
          status: "ready",
          jobs: [{ id: "q1", slug: "pvp", name: "PvP", emoji: "⚔️" }],
          durationHours: 2.5,
          availableFrom: "2026-09-17T00:00:00.000Z",
          availableUntil: null,
        },
        {
          entryId: "e2",
          userId: "user-b",
          displayName: "Priya",
          position: 2,
          status: "afk",
          jobs: [{ id: "q2", slug: "dungeon", name: "Dungeon", emoji: "🏰" }],
          durationHours: 0.8,
          availableFrom: "2026-09-17T00:00:00.000Z",
          availableUntil: null,
        },
      ],
      inLine: 2,
      afkCount: 1,
      onDutyCount: 0,
      onDuty: [],
      jobCount: 5,
    },
    "Asia/Manila",
    new Date("2026-09-17T00:12:00.000Z"),
  );
  assert.match(table, /^-# 1 Alex/m);
  assert.match(table, /-#   Status: 🟢 In line/);
  assert.match(table, /-#   Status: 🟡 AFK/);
  assert.match(table, /-#   Jobs: PvP/);
  assert.match(table, /-#   Jobs: Dungeon/);
  assert.match(table, /-#   Hours: 2\.5h · Wait: 12m/);
  assert.match(table, /-#   Hours: 0\.8h · Wait: 12m/);
  assert.match(table, /-# ---------/);
  assert.match(table, /-# 🟢 in line/);
  assert.match(table, /-# 🟡 AFK/);
  assert.match(table, /-# 🔴 on duty/);
  assert.equal(table.includes("```"), false);
  assert.equal(table.includes("ADDED"), false);
  assert.equal(/\n-#\n/.test(table), false);
});

test("dashboard queue lists every person, including the ninth", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    entryId: `e${index + 1}`,
    userId: `user-${index + 1}`,
    displayName: `User${index + 1}`,
    position: index + 1,
    status: "ready" as const,
    jobs: [{ id: "q1", slug: "pvp", name: "PvP", emoji: "⚔️" }],
    durationHours: 2,
    availableFrom: "2026-09-17T00:00:00.000Z",
    availableUntil: null,
  }));
  const payload = dutyLineDashboardPayload(
    {
      rows,
      inLine: 10,
      afkCount: 0,
      onDutyCount: 0,
      onDuty: [],
      jobCount: 5,
    },
    "Asia/Manila",
    NOW,
  );
  const description = payload.embeds[0]!.data.description ?? "";
  assert.match(description, /9 User9/);
  assert.match(description, /10 User10/);
  assert.equal(description.includes("+2 more"), false);
});

test("dashboard JOBS sit on a Jobs line", () => {
  const leno = formatDashboardEntry(
    {
      entryId: "e1",
      userId: "user-a",
      displayName: "LENO",
      position: 1,
      status: "ready",
      jobs: [
        { id: "q1", slug: "pvp", name: "PvP", emoji: "⚔️" },
        { id: "q2", slug: "dungeon", name: "Dungeon", emoji: "🏰" },
        { id: "q3", slug: "abyss", name: "Abyss", emoji: "✨" },
        { id: "q4", slug: "pet-farm", name: "Pet Farm", emoji: "🐾" },
      ],
      durationHours: 2,
      availableFrom: "2026-09-17T00:00:00.000Z",
      availableUntil: "2026-09-17T02:00:00.000Z",
    },
    "Asia/Manila",
    5,
    NOW,
  );
  const vy = formatDashboardEntry(
    {
      entryId: "e2",
      userId: "user-b",
      displayName: "Vy",
      position: 2,
      status: "ready",
      jobs: [
        { id: "q2", slug: "dungeon", name: "Dungeon", emoji: "🏰" },
        { id: "q5", slug: "exploration-leveling", name: "Exploration/Leveling", emoji: "🧭" },
      ],
      durationHours: null,
      availableFrom: "2026-09-17T00:00:00.000Z",
      availableUntil: null,
    },
    "Asia/Manila",
    5,
    NOW,
  );
  assert.match(leno, /-#   Jobs: PvP, Dungeon, Abyss, Pet Farm/);
  assert.match(vy, /-#   Jobs: Dungeon, Exploration/);
  assert.match(vy, /-#   Hours: - · Wait: <1m/);
  assert.equal(vy.includes("Leveling"), false);
});

test("dashboard NAME stays filled when displayName is blank or decorative", () => {
  const jobs = [{ id: "q1", slug: "abyss", name: "Abyss", emoji: "✨" }];
  const named = formatDashboardEntry(
    {
      entryId: "e1",
      userId: "user-a",
      displayName: "LENO",
      position: 1,
      status: "afk",
      jobs,
      durationHours: 12,
      availableFrom: "2026-09-17T00:00:00.000Z",
      availableUntil: "2026-09-17T12:00:00.000Z",
    },
    "Asia/Manila",
    5,
    NOW,
  );
  const blank = formatDashboardEntry(
    {
      entryId: "e2",
      userId: "123456789012345678",
      displayName: "\u200B🔥",
      position: 1,
      status: "afk",
      jobs,
      durationHours: 12,
      availableFrom: "2026-09-17T00:00:00.000Z",
      availableUntil: "2026-09-17T12:00:00.000Z",
    },
    "Asia/Manila",
    5,
    NOW,
  );
  const fancy = formatDashboardEntry(
    {
      entryId: "e3",
      userId: "123456789012345678",
      displayName: "𝐋𝐄𝐍𝐎",
      position: 1,
      status: "afk",
      jobs,
      durationHours: 12,
      availableFrom: "2026-09-17T00:00:00.000Z",
      availableUntil: "2026-09-17T12:00:00.000Z",
    },
    "Asia/Manila",
    5,
    NOW,
  );
  assert.match(named, /-# 1 LENO/);
  assert.match(blank, /5678/);
  assert.match(fancy, /LENO/);
  assert.equal(pickDiscordDisplayName({ displayName: "\u200B", username: "Vy", userId: "1" }), "Vy");
});

test("duty line card includes a live updated timestamp", () => {
  const at = new Date("2026-09-17T00:00:00.000Z");
  const payload = dutyLineDashboardPayload(
    {
      rows: [],
      inLine: 0,
      afkCount: 0,
      onDutyCount: 0,
      onDuty: [],
      jobCount: 5,
    },
    "Asia/Manila",
    at,
  );
  const embed = payload.embeds[0]!.toJSON();
  assert.equal(embed.title, "Queue");
  assert.equal(embed.color, 0x14b8a6);
  assert.match(embed.description ?? "", /🟢 \*\*LIVE\*\*/);
  assert.match(embed.description ?? "", /0 in line • 0 AFK • 0 on duty • Updated <t:\d+:R>/);
  assert.match(embed.description ?? "", /\*\*IN LINE\*\*/);
  assert.match(embed.description ?? "", /```\nNobody is in line\.\n```/);
  assert.match(embed.description ?? "", /\*\*ON DUTY\*\*/);
  assert.match(embed.description ?? "", /\*No one on duty\.\*/);
  assert.match(embed.description ?? "", /-# 🟢 in line • 🟡 AFK • 🔴 on duty/);
  assert.equal((embed.description ?? "").includes("----------"), false);
  assert.equal((embed.description ?? "").includes("𝗤𝘂𝗲𝘂𝗲"), false);
  assert.equal((embed.description ?? "").includes("Qᴜᴇᴜᴇ"), false);
  assert.match(embed.description ?? "", /🟡 AFK/);
  assert.match(embed.description ?? "", /🔴 on duty/);
  assert.equal(embed.footer?.text, "LenQ • Queue Management");
  assert.equal(embed.timestamp, at.toISOString());
  assert.equal("components" in payload, false);
});

test("buildQueueEmbed shares formatEntry for queue and on-duty people", () => {
  const person = {
    position: 1,
    name: "Vy",
    status: "In line" as const,
    jobs: ["Pet Farm", "Exploration"],
    hours: null,
    waitMinutes: 37,
  };
  assert.equal(
    formatEntry(person),
    "1 Vy\nStatus: 🟢 In line\nJobs: Pet Farm, Exploration\nHours: - · Wait: 37m",
  );
  assert.equal(
    formatEntry({
      ...person,
      jobs: ["Pet Farm (≤12h)", "Abyss (≥15h)"],
    }),
    "1 Vy\nStatus: 🟢 In line\nJobs: Pet Farm (≤12h), Abyss (≥15h)\nHours: - · Wait: 37m",
  );
  const embed = buildQueueEmbed({
    inLine: 2,
    afk: 0,
    onDuty: 1,
    updatedAt: new Date("2026-09-17T00:00:00.000Z"),
    queue: [
      person,
      {
        position: 2,
        name: "Leno",
        status: "AFK",
        jobs: ["Dungeon", "Abyss", "Pet Farm"],
        hours: "2.5h",
        waitMinutes: 12,
      },
    ],
    onDutyList: [
      {
        position: 1,
        name: "Benjo",
        status: "On duty",
        jobs: ["PvP"],
        hours: "8h",
        waitMinutes: 14,
      },
    ],
  }).toJSON();
  assert.match(embed.description ?? "", /```\n1 Vy\nStatus: 🟢 In line/);
  assert.match(embed.description ?? "", /Wait: 37m\n\n2 Leno\nStatus: 🟡 AFK/);
  assert.match(embed.description ?? "", /```\n1 Benjo\nStatus: 🔴 On duty/);
  assert.equal(embed.description?.includes("----------"), false);
  assert.equal(embed.description?.includes("*No one on duty.*"), false);
});

test("on-duty block is a bulleted mention and job list", () => {
  const body = formatOnDutyBody(
    {
      rows: [],
      inLine: 0,
      afkCount: 0,
      onDutyCount: 2,
      onDuty: [
        {
          entryId: "e1",
          userId: "111",
          displayName: "Benjo",
          position: 1,
          status: "on_duty",
          jobs: [
            { id: "q1", slug: "exploration-leveling", name: "Exploration/Leveling", emoji: "🧭" },
            { id: "q2", slug: "pvp", name: "PvP", emoji: "⚔️" },
          ],
          acceptedJobs: [{ id: "q2", slug: "pvp", name: "PvP", emoji: "⚔️" }],
          durationHours: 2,
          availableFrom: "2026-09-17T00:00:00.000Z",
          availableUntil: null,
          updatedAt: "2026-09-17T00:00:00.000Z",
        },
        {
          entryId: "e2",
          userId: "222",
          displayName: "U3a3ef",
          position: 2,
          status: "on_duty",
          jobs: [{ id: "q1", slug: "exploration-leveling", name: "Exploration/Leveling", emoji: "🧭" }],
          durationHours: 2,
          availableFrom: "2026-09-17T00:00:00.000Z",
          availableUntil: null,
          updatedAt: "2026-09-17T00:00:00.000Z",
        },
      ],
      jobCount: 5,
    },
    "Asia/Manila",
    new Date("2026-09-17T00:14:00.000Z"),
  );
  assert.equal(
    body,
    "- 🔴 <@111> · PvP · 14m\n- 🔴 <@222> · Exploration/Leveling · 14m",
  );
  assert.equal(body.includes("ON DUTY"), false);
});

test("missing job rows still show the entry's J.O. name", () => {
  const db = createTestDb();
  store.ensureGuild(db, GUILD);
  const abyss = store.getQueueBySlug(db, GUILD, "abyss")!.id;
  joinQueue(db, {
    guildId: GUILD,
    queueId: abyss,
    userId: USER_A,
    hoursInput: "12",
    now: NOW,
  });
  db.prepare("DELETE FROM queue_entry_jobs").run();
  const line = listDutyLine(db, GUILD, NOW);
  assert.equal(formatJobList(line.rows[0]!.jobs, line.jobCount), "Abyss");
  const table = formatDutyLineTable(line, "Asia/Manila");
  assert.match(table, /Abyss/);
  assert.match(table, /Jobs: Abyss/);
});

test("entries without hours do not expire", () => {
  const db = createTestDb();
  const queueId = pvpId(db);
  const joined = joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_A,
    hoursInput: "",
    now: NOW,
  });
  assert.equal(joined.entry.durationHours, null);
  assert.equal(joined.entry.availableUntil, null);

  const expired = expireDue(db, new Date("2026-09-18T00:00:00.000Z"), GUILD);
  assert.equal(expired.length, 0);
  assert.ok(getUserQueueStatus(db, GUILD, USER_A, new Date("2026-09-18T00:00:00.000Z")));
});

test("AFK and dispatch update duty-line status", () => {
  const db = createTestDb();
  const queueId = pvpId(db);
  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_B,
    hoursInput: "4",
    now: NOW,
  });

  toggleAfk(db, { guildId: GUILD, userId: USER_B, now: NOW });
  const dispatched = dispatchNext(db, {
    guildId: GUILD,
    actorId: "staff",
    now: NOW,
  });
  assert.equal(dispatched.entry.userId, USER_A);
  assert.equal(dispatched.entry.status, "active");

  const line = listDutyLine(db, GUILD, NOW);
  assert.equal(line.afkCount, 1);
  assert.equal(line.onDutyCount, 1);
  assert.equal(line.inLine, 1);
  assert.equal(line.rows.find((row) => row.userId === USER_A), undefined);
  assert.equal(line.onDuty[0]?.userId, USER_A);
  assert.equal(line.rows.find((row) => row.userId === USER_B)?.status, "afk");
  assert.equal(line.rows.find((row) => row.userId === USER_B)?.position, 1);
  assert.equal(
    pickReadyForJob(line.rows, queueId)?.userId,
    undefined,
  );
});

test("queue-start job table is a padded code block without emoji", () => {
  const text = formatJobTable([
    { name: "PvP", waiting: 0, status: "open" },
    { name: "Exploration/Leveling", waiting: 1, status: "open" },
    { name: "Dungeon", waiting: 2, status: "closed" },
  ]);
  assert.match(text, /^```\nJOB/);
  assert.match(text, /WAITING/);
  assert.match(text, /STATUS/);
  assert.match(text, /PvP/);
  assert.match(text, /Exploration/);
  assert.equal(text.includes("Leveling"), false);
  assert.equal(text.includes("🟢"), false);
  assert.equal(text.includes("⚔️"), false);
  assert.match(text, /Open/);
  assert.match(text, /Closed/);
  const rows = text.replace(/```/g, "").trim().split("\n");
  for (const row of rows) {
    assert.ok(row.length <= 32, row);
  }
  const pvp = rows.find((row) => row.startsWith("PvP"));
  const header = rows[0];
  assert.equal(pvp?.indexOf("0"), header?.indexOf("WAITING"));
  assert.equal(pvp?.indexOf("Open"), header?.indexOf("STATUS"));

  const panel = formatQueuePanelLines([
    {
      id: "1",
      guildId: GUILD,
      slug: "pvp",
      name: "PvP",
      emoji: "⚔️",
      description: "",
      minHours: 0.5,
      maxHours: 24,
      maxSize: null,
      status: "open",
      sortOrder: 1,
      allowLeave: true,
      entriesExpire: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      waitingCount: 0,
    },
    {
      id: "2",
      guildId: GUILD,
      slug: "exploration-leveling",
      name: "Exploration/Leveling",
      emoji: "🧭",
      description: "",
      minHours: 0.5,
      maxHours: 24,
      maxSize: null,
      status: "open",
      sortOrder: 5,
      allowLeave: true,
      entriesExpire: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      waitingCount: 1,
    },
  ]);
  assert.equal(panel, formatJobTable([
    { name: "PvP", waiting: 0, status: "open" },
    { name: "Exploration/Leveling", waiting: 1, status: "open" },
  ]));

  const embed = queuePanelEmbed([]);
  assert.equal(embed.data.title, "Job orders");
  assert.match(embed.data.description ?? "", /Select one or more job orders to join a queue\./);
  assert.match(embed.data.description ?? "", /\*\*AVAILABLE\*\*/);
  assert.match(embed.data.description ?? "", /-# You can select multiple job orders\./);
  assert.equal(embed.data.footer?.text, "LenQ • Queue Management");
});

test("personal status channel names stay discord-safe and unique", () => {
  const name = personalStatusChannelName("Leno The Great!", "123456789012345678");
  assert.match(name, /^queue-status-leno-the-great-5678$/);
  assert.equal(name.length <= 100, true);
  assert.equal(personalStatusChannelName("@@@", "abc").startsWith("queue-status-user-"), true);
  assert.equal(isPersonalStatusChannelName("queue-status-leno-5678"), true);
  assert.equal(isPersonalStatusChannelName("queue-status"), false);
  assert.equal(isPersonalStatusChannelName("queue-dashboard"), false);
  const overwrites = personalStatusOverwrites("guild", "user", "bot");
  assert.equal(overwrites.length, 3);
  assert.equal(overwrites[0]?.id, "guild");
  assert.equal(overwrites[0]?.type, OverwriteType.Role);
  assert.deepEqual(overwrites[0]?.deny, [PermissionFlagsBits.ViewChannel]);
  assert.equal(overwrites[1]?.id, "user");
  assert.equal(overwrites[1]?.type, OverwriteType.Member);
  assert.deepEqual(overwrites[1]?.allow, [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
  ]);
  assert.deepEqual(overwrites[1]?.deny, [PermissionFlagsBits.SendMessages]);
  assert.equal(overwrites[2]?.id, "bot");
  assert.equal(overwrites[2]?.type, OverwriteType.Member);
  assert.ok(
    Array.isArray(overwrites[2]?.allow) &&
      overwrites[2].allow.includes(PermissionFlagsBits.ViewChannel) &&
      overwrites[2].allow.includes(PermissionFlagsBits.SendMessages) &&
      overwrites[2].allow.includes(PermissionFlagsBits.EmbedLinks) &&
      overwrites[2].allow.includes(PermissionFlagsBits.ReadMessageHistory) &&
      overwrites[2].allow.includes(PermissionFlagsBits.ManageMessages) &&
      overwrites[2].allow.includes(PermissionFlagsBits.ManageChannels),
  );
  const withBotRole = personalStatusOverwrites("guild", "user", "bot", "bot-role");
  assert.equal(withBotRole.length, 4);
  assert.equal(withBotRole[3]?.id, "bot-role");
  assert.equal(withBotRole[3]?.type, OverwriteType.Role);
  assert.equal(
    personalStatusOverwrites("guild", "user", "bot", "guild").length,
    3,
    "must not grant @everyone via the bot role overwrite",
  );
  const category = statusCategoryOverwrites("guild", "bot", "bot-role");
  assert.equal(category.length, 3);
  assert.equal(category[0]?.id, "guild");
  assert.equal(category[0]?.type, OverwriteType.Role);
  assert.deepEqual(category[0]?.deny, [PermissionFlagsBits.ViewChannel]);
  assert.equal(category[1]?.id, "bot");
  assert.equal(category[1]?.type, OverwriteType.Member);
  assert.equal(category[2]?.id, "bot-role");
  assert.ok(!category.some((overwrite) => overwrite.id === "staff"));
  assert.equal(statusCategoryOverwrites("guild", "bot", "guild").length, 2);
});

test("stores personal status category id on guilds", () => {
  const db = createTestDb();
  store.ensureGuild(db, GUILD);
  assert.equal(store.getGuild(db, GUILD)?.statusCategoryId, null);
  store.updateGuild(db, GUILD, { statusCategoryId: "cat-status" });
  assert.equal(store.getGuild(db, GUILD)?.statusCategoryId, "cat-status");
});

test("personal status channels stay gated off", () => {
  assert.equal(PERSONAL_STATUS_CHANNELS_ENABLED, false);
});

test("ephemeral queue buttons still expose leave and AFK", () => {
  const labels = (isAfk: boolean) =>
    userQueueButtons(true, isAfk).components.map((button) =>
      "label" in button.data ? button.data.label : undefined,
    );
  const ids = userQueueButtons(true, false).components.map((button) =>
    "custom_id" in button.data ? button.data.custom_id : undefined,
  );
  assert.deepEqual(ids, [Ids.refresh, Ids.myStatus, Ids.afk, Ids.leave]);
  assert.deepEqual(labels(false), ["Refresh", "My Status", "AFK", "Leave Queue"]);
  assert.deepEqual(labels(true), ["Refresh", "My Status", "Ready", "Leave Queue"]);
});

test("join embed hides personal status channel while the feature is off", () => {
  assert.equal(PERSONAL_STATUS_CHANNELS_ENABLED, false);
  const embed = joinedEmbed(
    {
      entry: {
        id: "e1",
        guildId: GUILD,
        queueId: "q1",
        userId: USER_A,
        sortKey: 1,
        durationHours: null,
        availableUntil: null,
        status: "waiting",
        isAfk: false,
        offerStrikes: 0,
        acceptedJobIds: [],
        jobHourPrefs: {},
        statusChannelId: "unknown",
        statusMessageId: null,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
      jobs: [],
      position: 1,
      peopleAhead: 0,
    },
    "UTC",
    1,
    "unknown",
  );
  const payload = JSON.stringify(embed.data).toLowerCase();
  const names = embed.data.fields?.map((field) => field.name) ?? [];
  assert.equal(names.includes("Your status"), false);
  assert.equal(payload.includes("unknown"), false);
  assert.equal(payload.includes("live updates"), false);
  assert.ok(names.includes("J.O."));
  assert.ok(names.includes("Position"));
  assert.ok(names.includes("People ahead"));
  assert.ok(names.some((name) => name.includes("Availability")));
});

test("on-duty people leave the waiting table but stay in the on-duty block", () => {
  const db = createTestDb();
  const queueId = pvpId(db);
  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_B,
    hoursInput: "4",
    now: NOW,
  });
  dispatchNext(db, { guildId: GUILD, actorId: "staff", now: NOW });
  const line = listDutyLine(db, GUILD, NOW);
  assert.deepEqual(
    line.rows.map((row) => row.userId),
    [USER_B],
  );
  assert.equal(line.rows[0]?.position, 1);
  assert.equal(line.onDuty[0]?.userId, USER_A);
  assert.equal(line.inLine, 1);
});

test("manual declines do not requeue; two missed DMs move to the end", () => {
  const db = createTestDb();
  const queueId = pvpId(db);
  const a = joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_A,
    hoursInput: "8",
    now: NOW,
  });
  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_B,
    hoursInput: "8",
    now: NOW,
  });
  joinQueue(db, {
    guildId: GUILD,
    queueId,
    userId: USER_C,
    hoursInput: "8",
    now: NOW,
  });

  const declined = recordOfferPass(db, {
    guildId: GUILD,
    entryId: a.entry.id,
    actorId: "staff",
    reason: "declined",
    now: NOW,
  });
  assert.equal(declined.strikes, 0);
  assert.equal(declined.requeued, false);
  assert.equal(store.getEntry(db, a.entry.id)?.offerStrikes, 0);
  assert.equal(store.positionFor(db, store.getEntry(db, a.entry.id)!), 1);

  const firstMiss = recordOfferPass(db, {
    guildId: GUILD,
    entryId: a.entry.id,
    actorId: "staff",
    reason: "timeout",
    now: NOW,
  });
  assert.equal(firstMiss.strikes, 1);
  assert.equal(firstMiss.requeued, false);
  assert.equal(store.positionFor(db, store.getEntry(db, a.entry.id)!), 1);

  const secondMiss = recordOfferPass(db, {
    guildId: GUILD,
    entryId: a.entry.id,
    actorId: "staff",
    reason: "timeout",
    now: NOW,
  });
  assert.equal(secondMiss.strikes, 2);
  assert.equal(secondMiss.requeued, true);
  const moved = store.getEntry(db, a.entry.id)!;
  assert.equal(moved.status, "waiting");
  assert.equal(moved.offerStrikes, 0);
  assert.equal(store.positionFor(db, moved), 3);
});

test("job hour prefs persist and skip send-jo without strikes", () => {
  const db = createTestDb();
  store.ensureGuild(db, GUILD);
  const pet = store.getQueueBySlug(db, GUILD, "pet-farm")!.id;
  const abyss = store.getQueueBySlug(db, GUILD, "abyss")!.id;

  const joined = joinQueue(db, {
    guildId: GUILD,
    queueIds: [pet, abyss],
    userId: USER_A,
    hoursInput: "8",
    jobHoursInput: "pet:12- abyss:15+",
    now: NOW,
  });
  assert.deepEqual(joined.entry.jobHourPrefs[pet], { min: null, max: 12 });
  assert.deepEqual(joined.entry.jobHourPrefs[abyss], { min: 15, max: null });

  const line = listDutyLine(db, GUILD, NOW);
  const petJob = line.rows[0]?.jobs.find((job) => job.id === pet);
  const abyssJob = line.rows[0]?.jobs.find((job) => job.id === abyss);
  assert.equal(petJob?.hourMax, 12);
  assert.equal(abyssJob?.hourMin, 15);

  const payload = dutyLineDashboardPayload(line, "UTC", NOW);
  assert.match(payload.embeds[0]!.data.description ?? "", /Pet Farm \(≤12h\)/);
  assert.match(payload.embeds[0]!.data.description ?? "", /Abyss \(≥15h\)/);

  assert.equal(nextReadyForJob(db, GUILD, pet, [], NOW, 15), null);
  assert.equal(nextReadyForJob(db, GUILD, pet, [], NOW, 10)?.userId, USER_A);
  assert.equal(store.getEntry(db, joined.entry.id)?.offerStrikes, 0);
});

test("join hours modal is max and min number fields per job", () => {
  const modal = joinHoursModal([
    { id: "explo", name: "Exploration/Leveling" },
    { id: "abyss", name: "Abyss" },
  ]);
  const fields = modal.components.map((row) => row.components[0]!.data);
  assert.equal(modal.data.title, "Job Hours");
  assert.deepEqual(
    fields.map((field) => field.custom_id),
    ["j:max:explo", "j:min:explo", "j:max:abyss", "j:min:abyss"],
  );
  assert.deepEqual(
    fields.map((field) => field.label),
    ["Exploration Max", "Exploration Min", "Abyss Max", "Abyss Min"],
  );
  assert.equal(fields[0]?.placeholder, "hours or empty");
  assert.equal(fields[0]?.required, false);
});
