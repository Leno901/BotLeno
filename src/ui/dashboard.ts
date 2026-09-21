import {
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";
import { BRAND_COLOR } from "../config/defaults.js";
import type { DutyLine, DutyLineRow, DutyStatus } from "../types.js";
import { formatJobHourTag } from "../services/hours.js";
import { discordTimestamp } from "../services/time.js";
import { userStatusButtons } from "./components.js";
import {
  brandEmbed,
  dutyDisplayName,
  dutyStatusBadge,
  formatDutyLineTable,
} from "./embeds.js";

export interface QueueEmbedPerson {
  position: number;
  name: string;
  status: "In line" | "AFK" | "On duty";
  jobs: string[];
  hours: string | number | null;
  waitMinutes: number;
}

export interface QueueEmbedData {
  inLine: number;
  afk: number;
  onDuty: number;
  updatedAt?: Date;
  queue: QueueEmbedPerson[];
  onDutyList: QueueEmbedPerson[];
}

function statusEmoji(status: QueueEmbedPerson["status"]): string {
  if (status === "AFK") return "🟡";
  if (status === "On duty") return "🔴";
  return "🟢";
}

function dutyStatusPhrase(status: DutyStatus): QueueEmbedPerson["status"] {
  if (status === "afk") return "AFK";
  if (status === "on_duty") return "On duty";
  return "In line";
}

function shortJobName(name: string): string {
  const slash = name.indexOf("/");
  return slash > 0 ? name.slice(0, slash).trim() : name;
}

function hoursText(hours: string | number | null | undefined): string {
  if (hours == null || hours === "") return "-";
  return String(hours);
}

function waitMinutesSince(from: string, now: Date): number {
  const start = new Date(from).getTime();
  const ms = now.getTime() - start;
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 60_000);
}

function hoursFromDuration(hours: number | null): string | null {
  if (hours == null) return null;
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${hours.toFixed(1)}h`;
}

function jobsForRow(row: DutyLineRow, totalJobCount: number): string[] {
  const source =
    row.status === "on_duty" && row.acceptedJobs?.length ? row.acceptedJobs : row.jobs;
  if (source.length === 0) return ["-"];
  const tagged = source.some((job) => job.hourMin != null || job.hourMax != null);
  if (!tagged && totalJobCount > 0 && source.length >= totalJobCount) return ["All jobs"];
  const names = source
    .map((job) => `${shortJobName(job.name)}${formatJobHourTag(job.hourMin, job.hourMax)}`)
    .filter(Boolean);
  return names.length ? names : ["-"];
}

function toEmbedPerson(
  row: DutyLineRow,
  totalJobCount: number,
  now: Date,
): QueueEmbedPerson {
  return {
    position: row.position,
    name: dutyDisplayName(row),
    status: dutyStatusPhrase(row.status),
    jobs: jobsForRow(row, totalJobCount),
    hours: hoursFromDuration(row.durationHours),
    waitMinutes: waitMinutesSince(row.availableFrom, now),
  };
}

export function formatEntry(person: QueueEmbedPerson): string {
  return [
    `${person.position} ${person.name}`,
    `Status: ${statusEmoji(person.status)} ${person.status}`,
    `Jobs: ${person.jobs.join(", ") || "-"}`,
    `Hours: ${hoursText(person.hours)} · Wait: ${person.waitMinutes}m`,
  ].join("\n");
}

function formatEntryList(people: QueueEmbedPerson[]): string {
  return people.map(formatEntry).join("\n\n");
}

function boxed(body: string): string {
  return `\`\`\`\n${body}\n\`\`\``;
}

export function buildQueueEmbed(queueData: QueueEmbedData): EmbedBuilder {
  const updatedAt = queueData.updatedAt ?? new Date();
  const unix = Math.floor(updatedAt.getTime() / 1000);
  const queueBox = boxed(
    queueData.queue.length ? formatEntryList(queueData.queue) : "Nobody is in line.",
  );
  const onDutyBox = queueData.onDutyList.length
    ? boxed(formatEntryList(queueData.onDutyList))
    : "*No one on duty.*";

  return brandEmbed()
    .setTitle("Queue")
    .setDescription(
      [
        `🟢 **LIVE**`,
        `${queueData.inLine} in line • ${queueData.onDuty} on duty • Updated <t:${unix}:R>`,
        "",
        "**IN LINE**",
        queueBox,
        "",
        "**ON DUTY**",
        onDutyBox,
        "",
        "-# 🟢 in line • 🔴 on duty",
      ].join("\n"),
    )
    .setTimestamp(updatedAt);
}

export function dutyLineDashboardPayload(
  line: DutyLine,
  _timezone: string,
  updatedAt = new Date(),
) {
  const embed = buildQueueEmbed({
    inLine: line.inLine,
    afk: line.afkCount,
    onDuty: line.onDutyCount,
    updatedAt,
    queue: line.rows.map((row) => toEmbedPerson(row, line.jobCount, updatedAt)),
    onDutyList: line.onDuty.map((row) => toEmbedPerson(row, line.jobCount, updatedAt)),
  });

  return {
    embeds: [embed],
    allowedMentions: { parse: [] as Array<"users" | "roles" | "everyone"> },
  };
}

export function personalStatusPayload(options: {
  row: DutyLineRow;
  timezone: string;
  jobCount: number;
  peopleAhead: number;
  allowLeave: boolean;
}) {
  const { row, timezone, jobCount, peopleAhead, allowLeave } = options;
  const line: DutyLine = {
    rows: [row],
    inLine: 1,
    afkCount: 0,
    onDutyCount: row.status === "on_duty" ? 1 : 0,
    onDuty: row.status === "on_duty" ? [row] : [],
    jobCount,
  };
  const statusLine =
    row.status === "on_duty"
      ? "You are **ON DUTY**."
      : `You are **READY**. ${peopleAhead} ahead of you.`;

  const container = new ContainerBuilder()
    .setAccentColor(BRAND_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        ["## YOUR QUEUE STATUS", dutyStatusBadge(row.status), statusLine, `Updated: ${discordTimestamp(new Date(), "R")}`].join(
          "\n",
        ),
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(formatDutyLineTable(line, timezone)),
    )
    .addActionRowComponents(
      userStatusButtons({
        onDuty: row.status === "on_duty",
        allowLeave,
      }),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# Only you can see this channel."),
    );

  return {
    flags: MessageFlags.IsComponentsV2 as const,
    components: [container],
    allowedMentions: { parse: [] as Array<"users" | "roles" | "everyone"> },
  };
}
