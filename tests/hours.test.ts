import assert from "node:assert/strict";
import test from "node:test";
import { parseDurationHours } from "../src/services/hours.js";

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
