import assert from "node:assert/strict";
import test from "node:test";
import {
  planSetup,
  setupReport,
  type ResourceProbe,
} from "../src/services/setup-plan.js";

function probe(
  key: ResourceProbe["key"],
  storedId: string | null,
  byId: string | null,
  byName: string | null,
): ResourceProbe {
  return {
    key,
    storedId,
    byId: byId ? { id: byId, name: key } : null,
    byName: byName ? { id: byName, name: key } : null,
  };
}

const keys = ["category", "statusCategory", "panel", "status", "admin", "logs", "staffRole"] as const;

test("first run creates every missing resource and does not invent ids", () => {
  const decisions = planSetup(keys.map((key) => probe(key, null, null, null)));
  assert.ok(decisions.every((decision) => decision.action === "create"));
  const report = setupReport(decisions);
  assert.equal(report.firstRun, true);
  assert.equal(report.fullyConfigured, false);
  assert.equal(report.missing.length, 7);
});

test("second run reuses stored ids and creates nothing", () => {
  const decisions = planSetup(
    keys.map((key) => probe(key, `${key}-id`, `${key}-id`, `${key}-id`)),
  );
  assert.ok(decisions.every((decision) => decision.action === "reuse"));
  const report = setupReport(decisions);
  assert.equal(report.fullyConfigured, true);
  assert.equal(report.missing.length, 0);
  assert.ok(report.lines.every((line) => line.startsWith("✓")));
});

test("recreates only the missing panel and leaves the rest intact", () => {
  const decisions = planSetup([
    probe("category", "cat", "cat", "cat"),
    probe("statusCategory", "status-cat", "status-cat", "status-cat"),
    probe("panel", "old-panel", null, null),
    probe("status", "status", "status", "status"),
    probe("admin", "admin", "admin", "admin"),
    probe("logs", "logs", "logs", "logs"),
    probe("staffRole", "staff", "staff", "staff"),
  ]);
  const panel = decisions.find((decision) => decision.key === "panel");
  assert.equal(panel?.action, "create");
  assert.equal(setupReport(decisions).missing.join(), "panel");
  assert.equal(
    decisions.filter((decision) => decision.action === "create").length,
    1,
  );
});

test("repairs a stored id when the resource still exists by name", () => {
  const decisions = planSetup([
    probe("panel", "stale", null, "live-panel"),
  ]);
  assert.equal(decisions[0]?.action, "repair-id");
  assert.equal(decisions[0]?.id, "live-panel");
});
