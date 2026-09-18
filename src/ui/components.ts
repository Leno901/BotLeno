import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Queue, QueueWithCount } from "../types.js";
import { Ids } from "../interactions/ids.js";
import { queueStatusLabel } from "./embeds.js";
import { SEND_JO_OFFER_MAX_LENGTH } from "../config/defaults.js";

export function queueSelectRow(queues: QueueWithCount[]) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(Ids.selectQueue)
    .setPlaceholder("Select J.O.s (multiple)")
    .setMinValues(1)
    .setMaxValues(Math.max(1, Math.min(25, queues.length)))
    .addOptions(
      queues.slice(0, 25).map((queue) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${queue.emoji} ${queue.name}`)
          .setValue(queue.id)
          .setDescription(
            `${queue.waitingCount} waiting • ${queueStatusLabel(queue.status)}`,
          ),
      ),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function userQueueButtons(showLeave = true, isAfk = false, onDuty = false) {
  const refresh = new ButtonBuilder()
    .setCustomId(Ids.refresh)
    .setLabel("Refresh")
    .setStyle(ButtonStyle.Secondary);

  const status = new ButtonBuilder()
    .setCustomId(Ids.myStatus)
    .setLabel("My Status")
    .setStyle(ButtonStyle.Primary);

  const afk = new ButtonBuilder()
    .setCustomId(Ids.afk)
    .setLabel(isAfk ? "Ready" : "AFK")
    .setStyle(isAfk ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setDisabled(onDuty);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(refresh, status, afk);

  if (showLeave) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(Ids.leave)
        .setLabel("Leave Queue")
        .setStyle(ButtonStyle.Danger),
    );
  }

  return row;
}

export function userStatusButtons(options: {
  isAfk: boolean;
  onDuty: boolean;
  allowLeave: boolean;
}) {
  const afk = new ButtonBuilder()
    .setCustomId(Ids.afk)
    .setLabel(options.isAfk ? "Ready" : "AFK")
    .setStyle(options.isAfk ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setDisabled(options.onDuty);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(afk);

  if (options.allowLeave) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(Ids.leave)
        .setLabel("Leave Queue")
        .setStyle(ButtonStyle.Danger),
    );
  }

  return row;
}

export function leaveConfirmButtons() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(Ids.leaveConfirm)
      .setLabel("Confirm Leave")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(Ids.leaveCancel)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );
}

export function hoursModal() {
  const hours = new TextInputBuilder()
    .setCustomId("hours")
    .setLabel("How many hours can you work? (optional)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Optional · max 24 hours")
    .setRequired(false)
    .setMaxLength(5);

  return new ModalBuilder()
    .setCustomId(Ids.joinModal)
    .setTitle("Join Duty Line")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(hours),
    );
}

function jobHourButtonLabel(name: string, bound: "Max" | "Min"): string {
  const slash = name.indexOf("/");
  const short = (slash > 0 ? name.slice(0, slash).trim() : name).slice(0, 70);
  return `${short} ${bound}`.slice(0, 80);
}

export function jobHoursSetupRows(
  queues: Array<{ id: string; name: string }>,
  prefs: Record<string, { min?: number | null; max?: number | null }>,
) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const shown = queues.slice(0, 8);
  for (let i = 0; i < shown.length; i += 2) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const queue of shown.slice(i, i + 2)) {
      const pref = prefs[queue.id];
      const isMax = pref != null && pref.max != null && pref.min == null;
      const isMin = pref != null && pref.min != null && pref.max == null;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${Ids.joinJobMaxPrefix}${queue.id}`)
          .setLabel(jobHourButtonLabel(queue.name, "Max"))
          .setStyle(isMax ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`${Ids.joinJobMinPrefix}${queue.id}`)
          .setLabel(jobHourButtonLabel(queue.name, "Min"))
          .setStyle(isMin ? ButtonStyle.Success : ButtonStyle.Secondary),
      );
    }
    rows.push(row);
  }
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(Ids.joinJobHoursDone)
        .setLabel("Continue")
        .setStyle(ButtonStyle.Primary),
    ),
  );
  return rows;
}

export function jobHourNumberModal(
  queueId: string,
  queueName: string,
  bound: "max" | "min",
) {
  const hours = new TextInputBuilder()
    .setCustomId("hours")
    .setLabel(bound === "max" ? "Maximum hours" : "Minimum hours")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("12")
    .setRequired(true)
    .setMaxLength(5);

  const title = queueName.length <= 45 ? queueName : `${queueName.slice(0, 44)}.`;
  return new ModalBuilder()
    .setCustomId(`${Ids.joinJobNumModalPrefix}${bound}:${queueId}`)
    .setTitle(title)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(hours));
}

export function adminQueueSelect(queues: QueueWithCount[]) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(Ids.adminSelectQueue)
    .setPlaceholder("Select a queue to manage")
    .addOptions(
      queues.slice(0, 25).map((queue) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${queue.emoji} ${queue.name}`)
          .setValue(queue.id)
          .setDescription(
            `${queue.waitingCount} waiting • ${queueStatusLabel(queue.status)}`,
          ),
      ),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function adminMemberSelect(
  entries: Array<{ id: string; userId: string; position: number; name?: string }>,
) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(Ids.adminSelectEntry)
    .setPlaceholder("Select a waiting user")
    .addOptions(
      entries.slice(0, 25).map((entry) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`#${entry.position} ${entry.name ?? entry.userId}`.slice(0, 100))
          .setDescription(`ID ${entry.userId}`.slice(0, 100))
          .setValue(entry.id),
      ),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function adminQueueButtons(status: Queue["status"]) {
  const openOrResume =
    status === "open"
      ? new ButtonBuilder()
          .setCustomId(Ids.adminPause)
          .setLabel("Pause")
          .setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder()
          .setCustomId(Ids.adminOpen)
          .setLabel(status === "paused" ? "Resume" : "Open")
          .setStyle(ButtonStyle.Success);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    openOrResume,
    new ButtonBuilder()
      .setCustomId(Ids.adminClose)
      .setLabel("Close")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(Ids.adminClear)
      .setLabel("Clear Queue")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(Ids.adminRefresh)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Primary),
  );
}

export function adminEntryButtons() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(Ids.adminSkip)
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(Ids.adminComplete)
      .setLabel("Complete")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(Ids.adminRemove)
      .setLabel("Remove")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(Ids.adminMoveUp)
      .setLabel("Move Up")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(Ids.adminMoveDown)
      .setLabel("Move Down")
      .setStyle(ButtonStyle.Secondary),
  );
}

export function confirmClearButtons() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(Ids.adminClearConfirm)
      .setLabel("Confirm Clear")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(Ids.adminClearCancel)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );
}

export function sendJoQueueSelect(queues: QueueWithCount[]) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(Ids.sendJoSelect)
    .setPlaceholder("Select J.O.s (multiple)")
    .setMinValues(1)
    .setMaxValues(Math.max(1, Math.min(25, queues.length)))
    .addOptions(
      queues.slice(0, 25).map((queue) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${queue.emoji} ${queue.name}`)
          .setValue(queue.id)
          .setDescription(queueStatusLabel(queue.status)),
      ),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function sendJoModal() {
  const offer = new TextInputBuilder()
    .setCustomId("offer")
    .setLabel("Job / offer message")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("What should the player see?")
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(SEND_JO_OFFER_MAX_LENGTH);

  const jobHours = new TextInputBuilder()
    .setCustomId("jobHours")
    .setLabel("Job hours")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("12")
    .setRequired(true)
    .setMaxLength(8);

  return new ModalBuilder()
    .setCustomId(Ids.sendJoModal)
    .setTitle("Send J.O. offer")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(offer),
      new ActionRowBuilder<TextInputBuilder>().addComponents(jobHours),
    );
}

export function sendJoOfferButtons(token: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${Ids.sendJoYesPrefix}${token}`)
      .setLabel("Yes")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${Ids.sendJoNoPrefix}${token}`)
      .setLabel("No")
      .setStyle(ButtonStyle.Danger),
  );
}
