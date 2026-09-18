import assert from "node:assert/strict";
import test from "node:test";
import {
  describeQueueAction,
  formatQueueLog,
} from "../src/services/activity-log.js";

test("log copy names the actor and the exact action", () => {
  assert.equal(
    describeQueueAction({
      action: "joined",
      userId: "user-a",
      actorId: "user-a",
      detail: "Abyss · #1",
    }),
    "<@user-a> joined the duty line (Abyss · #1).",
  );
  assert.equal(
    describeQueueAction({
      action: "moved",
      userId: "user-a",
      actorId: "staff",
      detail: "#02",
    }),
    "<@staff> moved <@user-a> to #02 in the duty line.",
  );
});

test("log fields include active, activity, and done dates", () => {
  const log = formatQueueLog(
    {
      action: "joined",
      userId: "user-a",
      actorId: "user-a",
      detail: "Abyss · #1",
    },
    {
      activityAt: "2026-09-17T00:00:00.000Z",
      activeAt: "2026-09-17T00:00:00.000Z",
      doneAt: "2026-09-17T12:00:00.000Z",
    },
  );
  assert.equal(log.title, "Joined");
  assert.match(log.what, /joined the duty line/);
  assert.equal(log.user, "<@user-a>");
  assert.equal(log.by, "<@user-a>");
  assert.match(log.active, /<t:\d+:f>/);
  assert.match(log.activity, /<t:\d+:f>/);
  assert.match(log.done, /<t:\d+:f>/);
});

test("completed logs use the activity time as done", () => {
  const log = formatQueueLog(
    {
      action: "completed",
      userId: "user-a",
      actorId: "staff",
    },
    {
      activityAt: "2026-09-17T04:00:00.000Z",
      activeAt: "2026-09-17T00:00:00.000Z",
    },
  );
  assert.equal(log.by, "<@staff>");
  assert.match(log.what, /marked <@user-a>'s job complete/);
  assert.equal(
    log.done,
    log.activity,
  );
});
