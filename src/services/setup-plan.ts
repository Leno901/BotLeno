export type SetupResourceKey =
  | "category"
  | "statusCategory"
  | "panel"
  | "status"
  | "admin"
  | "logs"
  | "staffRole";

export interface NamedResource {
  id: string;
  name: string;
}

export interface ResourceProbe {
  key: SetupResourceKey;
  storedId: string | null;
  byId: NamedResource | null;
  byName: NamedResource | null;
}

export interface SetupDecision {
  key: SetupResourceKey;
  action: "create" | "reuse" | "repair-id";
  id?: string;
  found: boolean;
}

const LABELS: Record<SetupResourceKey, string> = {
  category: "Category",
  statusCategory: "Status category",
  panel: "Queue start",
  status: "Queue dashboard",
  admin: "Queue admin",
  logs: "Queue logs",
  staffRole: "Staff role",
};

export function planResource(probe: ResourceProbe): SetupDecision {
  if (probe.byId) {
    return {
      key: probe.key,
      action: "reuse",
      id: probe.byId.id,
      found: true,
    };
  }
  if (probe.byName) {
    return {
      key: probe.key,
      action: "repair-id",
      id: probe.byName.id,
      found: true,
    };
  }
  return { key: probe.key, action: "create", found: false };
}

export function planSetup(probes: ResourceProbe[]): SetupDecision[] {
  return probes.map(planResource);
}

export function setupReport(decisions: SetupDecision[]): {
  firstRun: boolean;
  fullyConfigured: boolean;
  missing: SetupResourceKey[];
  lines: string[];
} {
  const missing = decisions.filter((decision) => !decision.found).map((d) => d.key);
  const firstRun = decisions.every((decision) => decision.action === "create");
  const fullyConfigured = missing.length === 0;

  const lines = decisions.map((decision) => {
    const label = LABELS[decision.key];
    if (decision.found) return `✓ ${label} found`;
    return `✗ ${label} missing`;
  });

  return { firstRun, fullyConfigured, missing, lines };
}

export { LABELS as SETUP_RESOURCE_LABELS };
