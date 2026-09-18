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
import {
  formatCompactHours,
  formatDuration,
  formatInTimeZone,
  formatTableDate,
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

const NBSP = "\u00a0";
const SLOT_WIDTH = 2;
const NAME_WIDTH = 8;
const STATUS_WIDTH = 7;
const HOURS_WIDTH = 6;
const ADDED_WIDTH = 6;
const JOBS_MIN_WIDTH = 4;
const COL_GAP = "  ";
const ROW_CAP = 56;
const PREFIX_WIDTH =
  SLOT_WIDTH +
  NAME_WIDTH +
  STATUS_WIDTH +
  HOURS_WIDTH +
  ADDED_WIDTH +
  COL_GAP.length * 5;
const JOBS_WIDTH = ROW_CAP - PREFIX_WIDTH;

const TABLE_JOB_LABELS: Record<string, string> = {
  pvp: "PvP",
  dungeon: "Dun",
  abyss: "Aby",
  "pet-farm": "Pet",
  "pet farm": "Pet",
  "exploration-leveling": "Exp",
  "exploration/leveling": "Exp",
};

export function padMono(value: string, width: number): string {
  const clipped =
    value.length > width ? `${value.slice(0, Math.max(1, width - 1))}.` : value;
  return `\`${clipped.padEnd(width, NBSP)}\``;
}

export const DUTY_LINE_COLUMNS = {
  slot: SLOT_WIDTH,
  name: NAME_WIDTH,
  status: STATUS_WIDTH,
  hours: HOURS_WIDTH,
  added: ADDED_WIDTH,
  jobs: JOBS_WIDTH,
} as const;

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

function tableCell(value: string, width: number): string {
  const clean = asciiText(value);
  if (clean.length > width) {
    return `${clean.slice(0, Math.max(1, width - 1))}.`;
  }
  return clean.padEnd(width, " ");
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

function tableJobLabel(job: { name: string; slug?: string }): string {
  const slug = asciiText(job.slug ?? "").toLowerCase();
  const name = asciiText(job.name);
  const nameKey = name.toLowerCase();
  return TABLE_JOB_LABELS[slug] ?? TABLE_JOB_LABELS[nameKey] ?? name.slice(0, 3);
}

function joinJobLabels(labels: string[], maxWidth: number): string {
  if (labels.length === 0) return "-";
  const spaced = labels.join(", ");
  if (spaced.length <= maxWidth) return spaced;
  const compact = labels.join(",");
  if (compact.length <= maxWidth) return compact;
  if (maxWidth <= 3) return compact.slice(0, maxWidth);
  return `${compact.slice(0, maxWidth - 3)}...`;
}

export function formatTableJobNames(
  jobs: Array<{ name: string; slug?: string }>,
  totalJobCount: number,
): string {
  if (jobs.length === 0) return "-";
  if (totalJobCount > 0 && jobs.length >= totalJobCount) return "All";
  const labels = jobs.map(tableJobLabel).filter(Boolean);
  return joinJobLabels(labels, JOBS_WIDTH);
}

function jobsRemainder(value: string): string {
  const clean = asciiText(value).replace(/[\r\n]/g, "") || "-";
  if (clean.length > JOBS_WIDTH) {
    if (JOBS_WIDTH <= 3) return clean.slice(0, JOBS_WIDTH);
    return `${clean.slice(0, JOBS_WIDTH - 3)}...`;
  }
  if (clean.length < JOBS_MIN_WIDTH) {
    return clean.padEnd(JOBS_MIN_WIDTH, " ");
  }
  return clean;
}

export function formatTableJobs(
  jobs: Array<{ name: string; slug?: string }>,
  totalJobCount: number,
): string {
  return jobsRemainder(formatTableJobNames(jobs, totalJobCount));
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

function formatHoursCell(entry: DutyLineRow): string {
  const compact =
    entry.durationHours == null ? "-" : formatCompactHours(entry.durationHours);
  return tableCell(compact, HOURS_WIDTH);
}

function formatAddedCell(entry: DutyLineRow, timezone: string): string {
  return tableCell(formatTableDate(entry.availableFrom, timezone), ADDED_WIDTH);
}

export function formatDutyLineHeader(_nameWidth = NAME_WIDTH): string {
  return [
    tableCell("#", SLOT_WIDTH),
    tableCell("NAME", NAME_WIDTH),
    tableCell("STATUS", STATUS_WIDTH),
    tableCell("HOURS", HOURS_WIDTH),
    tableCell("ADDED", ADDED_WIDTH),
    jobsRemainder("JOBS"),
  ].join(COL_GAP);
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
    .setFooter({ text: "BotLenoAPP • Queue Management" });
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

export function formatQueuePanelLine(
  queue: QueueWithCount,
  nameWidth: number,
  waitingWidth: number,
): string {
  return [
    queue.emoji,
    padMono(queue.name, nameWidth),
    padMono(`${queue.waitingCount} waiting`, waitingWidth),
    `${queueStatusIcon(queue.status)} ${queueStatusLabel(queue.status)}`,
  ].join("  ");
}

export function formatQueuePanelLines(queues: QueueWithCount[]): string {
  if (queues.length === 0) return "_No job orders configured._";
  const nameWidth = Math.min(
    22,
    Math.max(12, ...queues.map((queue) => queue.name.length)),
  );
  const waitingWidth = Math.max(
    9,
    ...queues.map((queue) => `${queue.waitingCount} waiting`.length),
  );
  return queues
    .map((queue) => formatQueuePanelLine(queue, nameWidth, waitingWidth))
    .join("\n");
}

export function queuePanelEmbed(queues: QueueWithCount[]): EmbedBuilder {
  return brandEmbed()
    .setTitle("🎯 BOTLENO QUEUE")
    .setDescription(
      [
        "Choose one or more job orders below.",
        "",
        "**Available J.O.**",
        formatQueuePanelLines(queues),
        "",
        "You can select multiple J.O.s.",
      ].join("\n"),
    );
}

export function formatDashboardEntry(
  entry: DutyLineRow,
  timezone: string,
  totalJobCount: number,
  _nameWidth = NAME_WIDTH,
): string {
  const slot = String(entry.position).padStart(SLOT_WIDTH, "0");
  return [
    tableCell(slot, SLOT_WIDTH),
    tableCell(dutyDisplayName(entry), NAME_WIDTH),
    tableCell(dutyStatusText(entry.status), STATUS_WIDTH),
    formatHoursCell(entry),
    formatAddedCell(entry, timezone),
    formatTableJobs(entry.jobs, totalJobCount),
  ]
    .join(COL_GAP)
    .replace(/[\r\n]/g, "")
    .slice(0, ROW_CAP);
}

function wrapDutyTable(body: string): string {
  return `\`\`\`\n${body}\n\`\`\``;
}

export function formatDutyLineTable(line: DutyLine, timezone: string): string {
  const visible = line.rows.slice(0, 12);
  const header = formatDutyLineHeader();
  if (visible.length === 0) {
    return `${wrapDutyTable(header)}\n_Nobody is in the duty line._`;
  }

  const rows = visible
    .map((entry) => formatDashboardEntry(entry, timezone, line.jobCount))
    .join("\n");
  const extra =
    line.rows.length > 12 ? `\n_+${line.rows.length - 12} more_` : "";
  return `${wrapDutyTable(`${header}\n${rows}`)}${extra}`;
}

export function formatOnDutyBody(line: DutyLine): string {
  if (line.onDuty.length === 0) return "_No one on duty._";
  return line.onDuty
    .map(
      (row) =>
        `**ON DUTY**  <@${row.userId}> · ${formatJobList(row.jobs, line.jobCount)}`,
    )
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
    .setFooter({ text: "BotLenoAPP • Queue Management" });
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
      `${offerText}\n\nRespond **Yes** or **No** <t:${expiresAtUnix}:R>.`,
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
