import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";
import { BRAND_COLOR } from "../config/defaults.js";
import type { DutyLine, DutyLineRow } from "../types.js";
import { discordTimestamp, formatClock } from "../services/time.js";
import { userStatusButtons } from "./components.js";
import { dutyStatusBadge, formatDutyLineTable, formatOnDutyBody } from "./embeds.js";

export function dutyLineDashboardPayload(
  line: DutyLine,
  timezone: string,
  updatedAt = new Date(),
) {
  const container = new ContainerBuilder()
    .setAccentColor(BRAND_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "## DUTY LINE",
          `🟢 **LIVE**`,
          `${line.inLine} in line • ${line.afkCount} AFK • ${line.onDutyCount} on duty • Updated ${discordTimestamp(updatedAt, "R")}`,
        ].join("\n"),
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**QUEUE**\n${formatDutyLineTable(line, timezone, updatedAt)}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**On duty**\n${formatOnDutyBody(line, timezone, updatedAt)}`,
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# BotLenoAPP • Queue Management · ${formatClock(updatedAt, timezone)}`,
      ),
    );

  return {
    flags: MessageFlags.IsComponentsV2 as const,
    components: [container],
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
    afkCount: row.status === "afk" ? 1 : 0,
    onDutyCount: row.status === "on_duty" ? 1 : 0,
    onDuty: row.status === "on_duty" ? [row] : [],
    jobCount,
  };
  const statusLine =
    row.status === "afk"
      ? "You are **AFK**. You will not be dispatched until you press Ready."
      : row.status === "on_duty"
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
        isAfk: row.status === "afk",
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
