import { ABSOLUTE_MAX_HOURS } from "../config/defaults.js";

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
