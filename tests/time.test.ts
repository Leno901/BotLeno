import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAvailableUntil,
  formatDuration,
  formatInTimeZone,
  formatShortDate,
  formatTableDate,
  isValidTimeZone,
} from "../src/services/time.js";

test("adds duration hours onto the provided instant", () => {
  const start = new Date("2026-09-17T00:00:00.000Z");
  const until = calculateAvailableUntil(start, 8);
  assert.equal(until.toISOString(), "2026-09-17T08:00:00.000Z");
});

test("formats availability in the guild timezone, not the host timezone", () => {
  const formatted = formatInTimeZone(
    "2026-09-17T00:00:00.000Z",
    "Asia/Manila",
  );
  assert.equal(formatted.time, "8:00 AM");
  assert.equal(formatted.date, "September 17, 2026");
  assert.equal(formatted.combined, "8:00 AM • September 17, 2026");
});

test("rejects unknown timezones", () => {
  assert.equal(isValidTimeZone("Asia/Manila"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
});

test("formats hour labels", () => {
  assert.equal(formatDuration(1), "1 hour");
  assert.equal(formatDuration(8), "8 hours");
  assert.equal(formatDuration(1.5), "1.5 hours");
});

test("formats a short added date in the guild timezone", () => {
  assert.equal(
    formatShortDate("2026-09-17T00:00:00.000Z", "Asia/Manila"),
    "Sep 17, 2026",
  );
});

test("formats a compact table date without the year", () => {
  assert.equal(
    formatTableDate("2026-09-17T00:00:00.000Z", "Asia/Manila"),
    "Sep 17",
  );
});
