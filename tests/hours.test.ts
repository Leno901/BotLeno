import assert from "node:assert/strict";
import test from "node:test";
import {
  formatJobHourTag,
  jobAllowsHours,
  parseDurationHours,
  parseHourRange,
  parseJobHourPrefs,
  parseOfferJobHours,
} from "../src/services/hours.js";

test("accepts whole and decimal hours within limits", () => {
  assert.deepEqual(parseDurationHours("8", 0.5), { ok: true, hours: 8 });
  assert.deepEqual(parseDurationHours("1.5", 0.5), { ok: true, hours: 1.5 });
  assert.deepEqual(parseDurationHours("24", 0.5), { ok: true, hours: 24 });
  assert.deepEqual(parseDurationHours(" 2 ", 0.5), { ok: true, hours: 2 });
});

test("empty hours means no time limit", () => {
  assert.deepEqual(parseDurationHours("", 0.5), { ok: true, hours: null });
  assert.deepEqual(parseDurationHours("   ", 0.5), { ok: true, hours: null });
});

test("rejects non-numeric, zero, negative, and overflow values", () => {
  assert.equal(parseDurationHours("abc", 0.5).ok, false);
  assert.equal(parseDurationHours("NaN", 0.5).ok, false);
  assert.equal(parseDurationHours("Infinity", 0.5).ok, false);
  assert.equal(parseDurationHours("0", 0.5).ok, false);
  assert.equal(parseDurationHours("-1", 0.5).ok, false);
  assert.equal(parseDurationHours("25", 0.5).ok, false);
  assert.equal(parseDurationHours("8 hours", 0.5).ok, false);
});

test("enforces a configurable minimum", () => {
  const result = parseDurationHours("0.25", 0.5);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Minimum availability is 0.5 hours/);
  }
});

const QUEUES = [
  { id: "pet", slug: "pet-farm", name: "Pet Farm" },
  { id: "abyss", slug: "abyss", name: "Abyss" },
];

test("parses job hour ranges and per-job prefs", () => {
  assert.deepEqual(parseHourRange("12-"), { min: null, max: 12 });
  assert.deepEqual(parseHourRange("15+"), { min: 15, max: null });
  assert.deepEqual(parseHourRange("8-12"), { min: 8, max: 12 });
  assert.deepEqual(parseJobHourPrefs("pet:12- abyss:15+", QUEUES), {
    ok: true,
    prefs: { pet: { min: null, max: 12 }, abyss: { min: 15, max: null } },
  });
  assert.deepEqual(parseJobHourPrefs("12-", QUEUES), {
    ok: true,
    prefs: { pet: { min: null, max: 12 }, abyss: { min: null, max: 12 } },
  });
  assert.equal(parseJobHourPrefs("raid:12-", QUEUES).ok, false);
  assert.equal(parseOfferJobHours("").ok, false);
  assert.deepEqual(parseOfferJobHours("12"), { ok: true, hours: 12 });
});

test("jobAllowsHours and formatJobHourTag", () => {
  assert.equal(jobAllowsHours({ min: null, max: 12 }, 12), true);
  assert.equal(jobAllowsHours({ min: null, max: 12 }, 13), false);
  assert.equal(jobAllowsHours({ hourMin: 15, hourMax: null }, 14), false);
  assert.equal(jobAllowsHours({ hourMin: 15, hourMax: null }, 15), true);
  assert.equal(jobAllowsHours(undefined, 12), true);
  assert.equal(formatJobHourTag(null, 12), " (≤12h)");
  assert.equal(formatJobHourTag(15, null), " (≥15h)");
});
