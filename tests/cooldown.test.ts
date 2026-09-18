import assert from "node:assert/strict";
import test from "node:test";
import { createCooldownTracker } from "../src/services/cooldown.js";

test("blocks a second action inside the cooldown window", () => {
  const tracker = createCooldownTracker();
  const now = 1_000_000;
  assert.equal(tracker.hit("user:join", 3000, now), 0);
  assert.equal(tracker.hit("user:join", 3000, now + 500), 2500);
});

test("allows the action after the window expires", () => {
  const tracker = createCooldownTracker();
  const now = 1_000_000;
  tracker.hit("user:join", 3000, now);
  assert.equal(tracker.hit("user:join", 3000, now + 3000), 0);
});
