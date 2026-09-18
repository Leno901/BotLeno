import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAvailableUntil,
  formatDuration,
  formatElapsedCompact,
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

test("formats compact elapsed wait times", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");
  assert.equal(formatElapsedCompact("2026-09-17T11:59:30.000Z", now), "<1m");
  assert.equal(formatElapsedCompact("2026-09-17T11:48:00.000Z", now), "12m");
  assert.equal(formatElapsedCompact("2026-09-17T10:00:00.000Z", now), "2h");
  assert.equal(formatElapsedCompact("2026-09-17T09:40:00.000Z", now), "2h 20m");
  assert.equal(formatElapsedCompact("2026-09-15T12:00:00.000Z", now), "2d");
  assert.equal(formatElapsedCompact("2026-09-15T10:00:00.000Z", now), "2d 2h");
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
