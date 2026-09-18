import { DateTime, IANAZone } from "luxon";
import { DEFAULT_TIMEZONE } from "../config/defaults.js";

export function isValidTimeZone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

export function resolveTimeZone(zone: string | null | undefined): string {
  if (zone && isValidTimeZone(zone)) return zone;
  return DEFAULT_TIMEZONE;
}

export function nowUtc(): Date {
  return new Date();
}

export function calculateAvailableUntil(
  now: Date,
  durationHours: number,
): Date {
  return new Date(now.getTime() + durationHours * 60 * 60 * 1000);
}

export function toUtcIso(date: Date): string {
  return date.toISOString();
}

export function formatDuration(hours: number): string {
  const rounded = Number.isInteger(hours)
    ? String(hours)
    : hours
        .toFixed(2)
        .replace(/0+$/, "")
        .replace(/\.$/, "");
  return `${rounded} ${hours === 1 ? "hour" : "hours"}`;
}

export function formatCompactHours(hours: number | null | undefined): string {
  if (hours == null) return "—";
  const rounded = Number.isInteger(hours)
    ? String(hours)
    : hours
        .toFixed(2)
        .replace(/0+$/, "")
        .replace(/\.$/, "");
  return `${rounded}h`;
}

export function discordTimestamp(
  value: string | Date,
  style: "f" | "F" | "d" | "R" = "f",
): string {
  const date =
    value instanceof Date ? value : DateTime.fromISO(value, { zone: "utc" }).toJSDate();
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export function formatClock(value: string | Date, timeZone: string): string {
  const zone = resolveTimeZone(timeZone);
  const date =
    value instanceof Date ? value : DateTime.fromISO(value, { zone: "utc" }).toJSDate();
  return DateTime.fromJSDate(date, { zone: "utc" }).setZone(zone).toFormat("HH:mm");
}

export function formatClockRange(
  from: string | Date,
  until: string | Date,
  timeZone: string,
): string {
  return `${formatClock(from, timeZone)}–${formatClock(until, timeZone)}`;
}

export function formatShortDate(value: string | Date, timeZone: string): string {
  const zone = resolveTimeZone(timeZone);
  const date =
    value instanceof Date ? value : DateTime.fromISO(value, { zone: "utc" }).toJSDate();
  return DateTime.fromJSDate(date, { zone: "utc" }).setZone(zone).toFormat("LLL d, yyyy");
}

export function formatTableDate(value: string | Date, timeZone: string): string {
  const zone = resolveTimeZone(timeZone);
  const date =
    value instanceof Date ? value : DateTime.fromISO(value, { zone: "utc" }).toJSDate();
  return DateTime.fromJSDate(date, { zone: "utc" }).setZone(zone).toFormat("LLL d");
}

export function formatInTimeZone(
  value: string | Date,
  timeZone: string,
): { time: string; date: string; combined: string } {
  const zone = resolveTimeZone(timeZone);
  const date =
    value instanceof Date ? value : DateTime.fromISO(value, { zone: "utc" }).toJSDate();
  const dt = DateTime.fromJSDate(date, { zone: "utc" }).setZone(zone);
  const time = dt.toFormat("h:mm a");
  const dateLabel = dt.toFormat("LLLL d, yyyy");
  return {
    time,
    date: dateLabel,
    combined: `${time} • ${dateLabel}`,
  };
}
