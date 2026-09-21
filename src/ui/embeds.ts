import { EmbedBuilder } from "discord.js";
import {
  BRAND_COLOR,
  ERROR_COLOR,
  INFO_COLOR,
  PERSONAL_STATUS_CHANNELS_ENABLED,
  SUCCESS_COLOR,
  WARNING_COLOR,
} from "../config/defaults.js";
import type {
  DutyLine,
  DutyLineRow,
  DutyStatus,
  Queue,
  QueueStatus,
  QueueWithCount,
  UserQueueView,
} from "../types.js";
import { formatJobHourTag } from "../services/hours.js";
import {
  formatDuration,
  formatElapsedCompact,
  formatInTimeZone,
} from "../services/time.js";

export function queueStatusLabel(status: QueueStatus): string {
  if (status === "open") return "Open";
  if (status === "paused") return "Paused";
  return "Closed";
}

export function queueStatusIcon(status: QueueStatus): string {
  if (status === "open") return "🟢";
  if (status === "paused") return "🟡";
  return "🔴";
}

export function entryStatusLabel(status: string, isAfk = false): string {
  if (status === "active") return "🔴 ON DUTY";
  if (isAfk || status === "afk") return "🟡 AFK";
  switch (status) {
    case "waiting":
      return "🟢 READY";
    case "completed":
      return "✅ Completed";
    case "cancelled":
      return "⚪ Cancelled";
    case "expired":
      return "⏰ Expired";
    case "skipped":
      return "⏭ Skipped";
    default:
      return status;
  }
}

export function dutyStatusDot(status: DutyStatus): string {
  if (status === "on_duty") return "🔴";
  if (status === "afk") return "🟡";
  return "🟢";
}

export function dutyStatusText(status: DutyStatus): string {
  if (status === "on_duty") return "ON DUTY";
  if (status === "afk") return "AFK";
  return "READY";
}

export function dutyStatusBadge(status: DutyStatus): string {
  return `${dutyStatusDot(status)} ${dutyStatusText(status)}`;
}

const DUTY_STATUS_LEGEND = smallLines([
  "---------",
  "🟢 in line",
  "🔴 on duty",
]);
const QUEUE_CARD_LIMIT = 8;
const QUEUE_TEXT_LIMIT = 3500;

function jobShortName(job: { name: string }): string {
  const name = asciiText(job.name) || job.name;
  const slash = name.indexOf("/");
  return slash > 0 ? name.slice(0, slash).trim() : name;
}

function queueJobLabel(
  jobs: Array<{ name: string; hourMin?: number | null; hourMax?: number | null }>,
  totalJobCount: number,
): string {
  if (jobs.length === 0) return "-";
  const tagged = jobs.some((job) => job.hourMin != null || job.hourMax != null);
  if (!tagged && totalJobCount > 0 && jobs.length >= totalJobCount) return "All jobs";
  const names = jobs
    .map((job) => `${jobShortName(job)}${formatJobHourTag(job.hourMin, job.hourMax)}`)
    .filter(Boolean);
  return names.join(", ") || "-";
}

function lineStatusPhrase(status: DutyStatus): string {
  if (status === "on_duty") return "On duty";
  if (status === "afk") return "AFK";
  return "In line";
}

function smallLines(lines: readonly string[]): string {
  return lines.map((line) => (line.length === 0 ? "-#" : `-# ${line}`)).join("\n");
}

function hoursLabel(hours: number | null): string {
  return hours == null ? "-" : `${hours.toFixed(1)}h`;
}

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060]/g;

export function sanitizeDisplayName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(ZERO_WIDTH, "")
    .normalize("NFKC")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/[`\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function asciiText(value: string): string {
  return sanitizeDisplayName(value);
}

export function pickDiscordDisplayName(source: {
  displayName?: string | null;
  nickname?: string | null;
  globalName?: string | null;
  username?: string | null;
  userId?: string | null;
}): string {
  for (const value of [
    source.displayName,
    source.nickname,
    source.globalName,
    source.username,
  ]) {
    const clean = sanitizeDisplayName(value);
    if (clean) return clean;
  }
  if (source.userId && /^\d{17,20}$/.test(source.userId)) {
    return source.userId.slice(-4);
  }
  return "User";
}

export function dutyDisplayName(entry: {
  userId: string;
  displayName?: string | null;
  nickname?: string | null;
  globalName?: string | null;
  username?: string | null;
}): string {
  return pickDiscordDisplayName(entry);
}

export function formatJobList(
  jobs: Array<{ name: string }>,
  totalJobCount: number,
): string {
  if (jobs.length === 0) return "—";
  if (totalJobCount > 0 && jobs.length >= totalJobCount) return "All jobs";
  return jobs.map((job) => job.name).join(" • ");
}

export function brandEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setFooter({ text: "LenQ • Queue Management" });
}

export function successEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(SUCCESS_COLOR).setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

export function warningEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(WARNING_COLOR).setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

export function errorEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(ERROR_COLOR).setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

export function infoEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(INFO_COLOR).setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

const JOB_COL = 16;
const WAITING_COL = 7;
const STATUS_COL = 6;

function clipJobName(name: string, width: number): string {
  const short = jobShortName({ name }) || asciiText(name) || name;
  if (short.length <= width) return short;
  return `${short.slice(0, Math.max(1, width - 1))}.`;
}

export function formatJobTable(
  jobs: Array<{ name: string; waiting: number; status: string }>,
): string {
  const header = `${"JOB".padEnd(JOB_COL)} ${"WAITING".padEnd(WAITING_COL)} ${"STATUS".padEnd(STATUS_COL)}`;
  const rows =
    jobs.length === 0
      ? ["No jobs configured."]
      : jobs.map((job) => {
          const name = clipJobName(job.name, JOB_COL).padEnd(JOB_COL);
          const waiting = String(job.waiting).padEnd(WAITING_COL);
          const status = queueStatusLabel(
            job.status === "paused" || job.status === "closed" ? job.status : "open",
          ).padEnd(STATUS_COL);
          return `${name} ${waiting} ${status}`;
        });
  return `\`\`\`\n${header}\n${rows.join("\n")}\n\`\`\``;
}

export function formatQueuePanelLines(queues: QueueWithCount[]): string {
  return formatJobTable(
    queues.map((queue) => ({
      name: queue.name,
      waiting: queue.waitingCount,
      status: queue.status,
    })),
  );
}

export function queuePanelEmbed(queues: QueueWithCount[]): EmbedBuilder {
  return brandEmbed()
    .setTitle("Job orders")
    .setDescription(
      [
        "Select one or more job orders to join a queue.",
        "",
        "**AVAILABLE**",
        formatQueuePanelLines(queues),
        "",
        "-# You can select multiple job orders.",
      ].join("\n"),
    );
}

export function formatDashboardEntry(
  entry: DutyLineRow,
  _timezone: string,
  totalJobCount: number,
  now = new Date(),
): string {
  const name = asciiText(dutyDisplayName(entry)) || "User";
  return smallLines([
    `${entry.position} ${name}`,
    `  Status: ${dutyStatusDot(entry.status)} ${lineStatusPhrase(entry.status)}`,
    `  Jobs: ${queueJobLabel(entry.jobs, totalJobCount)}`,
    `  Hours: ${hoursLabel(entry.durationHours)} · Wait: ${formatElapsedCompact(entry.availableFrom, now)}`,
  ]);
}

function assembleQueueCards(cards: string[], hidden: number): string {
  if (cards.length === 0) {
    return `${smallLines(["_Nobody is in the duty line._"])}\n${DUTY_STATUS_LEGEND}`;
  }
  const extra = hidden > 0 ? `\n${smallLines([`+${hidden} more in line`])}` : "";
  return `${cards.join(`\n${smallLines(["---------"])}\n`)}${extra}\n${DUTY_STATUS_LEGEND}`;
}

export function formatDutyLineTable(
  line: DutyLine,
  timezone: string,
  now = new Date(),
): string {
  const cards: string[] = [];
  for (const entry of line.rows) {
    if (cards.length >= QUEUE_CARD_LIMIT) break;
    const next = formatDashboardEntry(entry, timezone, line.jobCount, now);
    const hiddenIfAdded = line.rows.length - (cards.length + 1);
    const trial = assembleQueueCards([...cards, next], hiddenIfAdded);
    if (cards.length > 0 && trial.length > QUEUE_TEXT_LIMIT) break;
    cards.push(next);
  }
  return assembleQueueCards(cards, line.rows.length - cards.length);
}

function onDutyJobLabel(row: DutyLineRow): string {
  const jobs = row.acceptedJobs?.length ? row.acceptedJobs : row.jobs;
  const names = jobs.map((job) => asciiText(job.name) || job.name).filter(Boolean);
  return names.join(", ") || "-";
}

export function formatOnDutyBody(
  line: DutyLine,
  _timezone: string,
  now = new Date(),
): string {
  if (line.onDuty.length === 0) {
    return "_No one on duty._";
  }
  return line.onDuty
    .map((row) => {
      const since = row.updatedAt ?? row.availableFrom;
      return `- 🔴 <@${row.userId}> · ${onDutyJobLabel(row)} · ${formatElapsedCompact(since, now)}`;
    })
    .join("\n");
}

export function availabilityFields(
  durationHours: number | null,
  availableUntil: string | null,
  timezone: string,
) {
  if (durationHours == null || !availableUntil) {
    return [
      {
        name: "⏱ Availability",
        value: "No time limit",
        inline: true,
      },
    ];
  }
  const formatted = formatInTimeZone(availableUntil, timezone);
  return [
    {
      name: "⏱ Availability",
      value: `Duration:\n${formatDuration(durationHours)}\n\nAvailable until:\n${formatted.combined}`,
      inline: true,
    },
  ];
}

export function joinedEmbed(
  view: {
    entry: UserQueueView["entry"];
    jobs: UserQueueView["jobs"];
    position: number;
    peopleAhead: number;
  },
  timezone: string,
  totalJobCount = view.jobs.length,
  statusChannelId?: string | null,
): EmbedBuilder {
  const embed = successEmbed("✅ Added to the duty line")
    .addFields(
      {
        name: "J.O.",
        value: formatJobList(view.jobs, totalJobCount),
        inline: true,
      },
      { name: "Position", value: `#${String(view.position).padStart(2, "0")}`, inline: true },
      { name: "People ahead", value: String(view.peopleAhead), inline: true },
      ...availabilityFields(
        view.entry.durationHours,
        view.entry.availableUntil,
        timezone,
      ),
    )
    .setFooter({ text: "LenQ • Queue Management" });
  if (PERSONAL_STATUS_CHANNELS_ENABLED && statusChannelId) {
    embed.addFields({
      name: "Your status",
      value: `Live updates in <#${statusChannelId}>`,
      inline: false,
    });
  }
  return embed;
}

export function userStatusEmbed(
  view: UserQueueView,
  timezone: string,
): EmbedBuilder {
  return brandEmbed()
    .setTitle("Your duty line status")
    .addFields(
      { name: "Position", value: `#${String(view.position).padStart(2, "0")}`, inline: true },
      {
        name: "J.O.",
        value: formatJobList(view.jobs, view.jobs.length),
        inline: true,
      },
      {
        name: "Status",
        value: entryStatusLabel(view.entry.status, view.entry.isAfk),
        inline: true,
      },
      ...availabilityFields(
        view.entry.durationHours,
        view.entry.availableUntil,
        timezone,
      ),
    );
}

export function alreadyQueuedEmbed(view: UserQueueView): EmbedBuilder {
  return warningEmbed(
    "⚠️ Already Queued",
    `You are already #${view.position} in the duty line.`,
  );
}

export function pausedQueueEmbed(queue: Queue): EmbedBuilder {
  return warningEmbed(
    "⚠️ Queue Paused",
    `The ${queue.name} queue is currently paused by staff.\nPlease try again later.`,
  );
}

export function missingSetupPermissionsEmbed(names: string[]): EmbedBuilder {
  const list = names.map((name) => `✗ ${name}`).join("\n");
  return errorEmbed(
    "❌ Setup Cannot Continue",
    `BotLenoAPP is missing:\n\n${list}\n\nPlease grant the required permission and run \`/setup\` again.`,
  );
}

export function roleHierarchyEmbed(roleName: string): EmbedBuilder {
  return errorEmbed(
    "❌ Role Hierarchy Error",
    `BotLenoAPP cannot manage:\n\n**${roleName}**\n\nMove the BotLenoAPP role above ${roleName} and run \`/setup\` again.`,
  );
}

export function expiredEmbed(queueName: string): EmbedBuilder {
  return warningEmbed(
    "⏰ Queue Entry Expired",
    `Your ${queueName} queue availability has expired.\n\nPlease join again if you are still available.`,
  );
}

export function adminQueueEmbed(
  queue: Queue,
  entries: Array<{ userId: string; position: number }>,
): EmbedBuilder {
  const list =
    entries
      .slice(0, 20)
      .map((entry) => `${entry.position}. <@${entry.userId}>`)
      .join("\n") || "_Queue is empty._";

  return brandEmbed()
    .setTitle(`${queue.emoji} ${queue.name} — Staff`)
    .setDescription(
      `${queueStatusIcon(queue.status)} ${queueStatusLabel(queue.status)} • ${entries.length} waiting`,
    )
    .addFields({ name: "Waiting", value: list.slice(0, 1024) });
}

export function historyEmbed(
  rows: Array<{ action: string; actorId: string; userId: string | null; createdAt: string }>,
): EmbedBuilder {
  const lines =
    rows
      .slice(0, 15)
      .map((row) => {
        const target = row.userId ? ` • <@${row.userId}>` : "";
        return `• **${row.action}** <@${row.actorId}>${target}`;
      })
      .join("\n") || "_No history yet._";

  return infoEmbed("📜 Queue History", lines);
}

export function setupResultEmbed(options: {
  title: string;
  lines: string[];
  note: string;
}): EmbedBuilder {
  return successEmbed(options.title, `${options.lines.join("\n")}\n\n${options.note}`);
}

export function sendJoOfferEmbed(
  queueName: string,
  offerText: string,
  expiresAtUnix: number,
): EmbedBuilder {
  return brandEmbed()
    .setTitle(`${queueName} J.O. offer`)
    .setDescription(
      `${offerText}\n\nRespond **Yes** or **No** <t:${expiresAtUnix}:R> (deadline <t:${expiresAtUnix}:T>).`,
    );
}

export function sendJoOfferResultEmbed(
  queueName: string,
  offerText: string,
  outcome: "accepted" | "declined" | "timeout",
): EmbedBuilder {
  if (outcome === "accepted") {
    return brandEmbed()
      .setColor(SUCCESS_COLOR)
      .setTitle(`${queueName} J.O. accepted`)
      .setDescription(`${offerText}\n\n**Accepted** — you are now ON DUTY.`);
  }
  if (outcome === "declined") {
    return brandEmbed()
      .setColor(WARNING_COLOR)
      .setTitle(`${queueName} J.O. declined`)
      .setDescription(
        `${offerText}\n\n**Declined** — you stay in line. The next person will be offered.`,
      );
  }
  return brandEmbed()
    .setColor(INFO_COLOR)
    .setTitle(`${queueName} J.O. skipped`)
    .setDescription(
      `${offerText}\n\n**No response** — this offer was skipped. Two missed DMs remove you from the line.`,
    );
}

export function queueLogEmbed(log: {
  title: string;
  what: string;
  user: string;
  by: string;
  active: string;
  activity: string;
  done: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(INFO_COLOR)
    .setTitle(log.title)
    .setDescription(log.what)
    .addFields(
      { name: "User", value: log.user, inline: true },
      { name: "By", value: log.by, inline: true },
      { name: "Active", value: log.active, inline: true },
      { name: "Activity", value: log.activity, inline: true },
      { name: "Done", value: log.done, inline: true },
    );
}
