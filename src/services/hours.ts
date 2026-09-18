import { ABSOLUTE_MAX_HOURS } from "../config/defaults.js";
import type { JobHourPref } from "../types.js";

export type HoursParseResult =
  | { ok: true; hours: number | null }
  | { ok: false; error: string };

const HOURS_PATTERN = /^(?:\d+|\d+\.\d{1,2}|\.\d{1,2})$/;

export function parseDurationHours(
  input: string,
  minHours: number,
  maxHours = ABSOLUTE_MAX_HOURS,
): HoursParseResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: true, hours: null };
  }
  if (!HOURS_PATTERN.test(trimmed)) {
    return { ok: false, error: "Hours must be a number. Example: 8 or 1.5" };
  }

  const hours = Number(trimmed);
  if (!Number.isFinite(hours)) {
    return { ok: false, error: "Hours must be a number. Example: 8 or 1.5" };
  }
  if (hours <= 0) {
    return { ok: false, error: "Hours must be greater than 0." };
  }

  const cap = Math.min(maxHours, ABSOLUTE_MAX_HOURS);
  if (hours > cap) {
    return { ok: false, error: `Hours cannot exceed ${cap}.` };
  }
  if (hours < minHours) {
    return {
      ok: false,
      error: `Minimum availability is ${minHours} hours.`,
    };
  }

  return { ok: true, hours };
}

export type JobHourPrefParse =
  | { ok: true; prefs: Record<string, JobHourPref> }
  | { ok: false; error: string };

const RANGE_TOKEN = /^(?:(\d+(?:\.\d{1,2})?)\s*-\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*([+-])?)$/;

function parseHourValue(raw: string): number | null {
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0 || hours > ABSOLUTE_MAX_HOURS) return null;
  return hours;
}

export function parseHourRange(token: string): JobHourPref | null {
  const trimmed = token.trim();
  const match = RANGE_TOKEN.exec(trimmed);
  if (!match) return null;
  if (match[1] && match[2]) {
    const min = parseHourValue(match[1]);
    const max = parseHourValue(match[2]);
    if (min == null || max == null || min > max) return null;
    return { min, max };
  }
  const hours = parseHourValue(match[3] ?? "");
  if (hours == null) return null;
  if (match[4] === "+") return { min: hours, max: null };
  return { min: null, max: hours };
}

function queueKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function matchPrefQueue<T extends { id: string; slug: string; name: string }>(
  token: string,
  queues: readonly T[],
): T | "ambiguous" | null {
  const key = queueKey(token);
  if (!key) return null;
  const hits = queues.filter((queue) => {
    const slug = queueKey(queue.slug);
    const name = queueKey(queue.name);
    return (
      slug === key ||
      name === key ||
      slug.startsWith(`${key}-`) ||
      name.startsWith(`${key}-`) ||
      slug.split("-")[0] === key
    );
  });
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) return "ambiguous";
  return null;
}

export function parseJobHourPrefs<T extends { id: string; slug: string; name: string }>(
  input: string,
  queues: readonly T[],
): JobHourPrefParse {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, prefs: {} };

  const tokens = trimmed.split(/[,;\n]+|\s+/).map((part) => part.trim()).filter(Boolean);
  const prefs: Record<string, JobHourPref> = {};
  let global: JobHourPref | null = null;

  for (const token of tokens) {
    const split = token.indexOf(":");
    if (split <= 0) {
      const range = parseHourRange(token);
      if (!range) {
        return { ok: false, error: "Use 12- , 15+ , 8-12 , or pet:12- abyss:15+." };
      }
      global = range;
      continue;
    }
    const range = parseHourRange(token.slice(split + 1));
    const queue = matchPrefQueue(token.slice(0, split), queues);
    if (!range || !queue || queue === "ambiguous") {
      return {
        ok: false,
        error: "Use job hours like pet:12- or abyss:15+. Unknown or extra job names are not allowed.",
      };
    }
    prefs[queue.id] = range;
  }

  if (global) {
    for (const queue of queues) {
      if (!prefs[queue.id]) prefs[queue.id] = global;
    }
  }
  return { ok: true, prefs };
}

export function parseOfferJobHours(input: string): HoursParseResult {
  const parsed = parseDurationHours(input, 0.25);
  if (parsed.ok && parsed.hours == null) {
    return { ok: false, error: "Enter the job hours. Example: 12" };
  }
  return parsed;
}

export function jobAllowsHours(
  pref: { hourMin?: number | null; hourMax?: number | null } | JobHourPref | undefined,
  hours: number | undefined,
): boolean {
  if (hours == null || pref == null) return true;
  const min = "min" in pref ? pref.min : pref.hourMin;
  const max = "max" in pref ? pref.max : pref.hourMax;
  if (min != null && hours < min) return false;
  if (max != null && hours > max) return false;
  return true;
}

export function formatJobHourTag(min?: number | null, max?: number | null): string {
  if (min == null && max == null) return "";
  if (min != null && max != null && min === max) return ` (${min}h)`;
  if (min != null && max == null) return ` (≥${min}h)`;
  if (min == null && max != null) return ` (≤${max}h)`;
  return ` (${min}-${max}h)`;
}
