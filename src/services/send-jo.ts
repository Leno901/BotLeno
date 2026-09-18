import { randomUUID } from "node:crypto";
import { ChannelType } from "discord.js";
import type { AppContext } from "../app-context.js";
import {
  SEND_JO_OFFER_MAX_LENGTH,
  SEND_JO_TIMEOUT_MS,
} from "../config/defaults.js";
import * as store from "../database/store.js";
import type { DutyLineRow } from "../types.js";
import { sendJoOfferButtons } from "../ui/components.js";
import { infoEmbed, sendJoOfferEmbed, successEmbed, warningEmbed } from "../ui/embeds.js";
import { AppError } from "./errors.js";
import { logQueueActivity } from "./activity-log.js";
import { dispatchEntry, nextReadyForJob, recordOfferPass } from "./queue.js";

interface OfferRef {
  channelId: string;
  messageId: string;
  via: "dm" | "panel";
}

interface SendJoChain {
  token: string;
  guildId: string;
  queueId: string;
  queueName: string;
  offerText: string;
  staffId: string;
  skipEntryIds: string[];
  currentEntryId: string;
  currentUserId: string;
  offerMessage: OfferRef | null;
  timer?: NodeJS.Timeout;
}

const chains = new Map<string, SendJoChain>();
const tokens = new Map<string, string>();

export function isSendJoBusy(guildId: string): boolean {
  return chains.has(guildId);
}

export function stopSendJoChains(): void {
  for (const chain of chains.values()) {
    if (chain.timer) clearTimeout(chain.timer);
  }
  chains.clear();
  tokens.clear();
}

export function validateOfferText(raw: string): string {
  const text = raw.trim();
  if (!text) {
    throw new AppError("Enter a J.O. offer message.", "INVALID_OFFER");
  }
  if (text.length > SEND_JO_OFFER_MAX_LENGTH) {
    throw new AppError(
      `Offer text is too long (max ${SEND_JO_OFFER_MAX_LENGTH} characters).`,
      "INVALID_OFFER",
    );
  }
  return text;
}

export function offerDeadlineUnix(nowMs = Date.now()): number {
  return Math.floor((nowMs + SEND_JO_TIMEOUT_MS) / 1000);
}

export async function startSendJo(
  ctx: AppContext,
  options: {
    guildId: string;
    queueId: string;
    offerText: string;
    staffId: string;
  },
): Promise<{ queueName: string }> {
  if (chains.has(options.guildId)) {
    throw new AppError(
      "A J.O. offer is already in progress. Wait until it finishes.",
      "SENDJO_BUSY",
    );
  }

  const queue = store.getQueue(ctx.db, options.queueId);
  if (!queue || queue.guildId !== options.guildId) {
    throw new AppError("That J.O. category could not be found.", "QUEUE_NOT_FOUND");
  }

  const first = nextReadyForJob(ctx.db, options.guildId, options.queueId);
  if (!first) {
    throw new AppError("No one in line is READY for that J.O.", "SENDJO_EMPTY");
  }

  const chain: SendJoChain = {
    token: randomUUID(),
    guildId: options.guildId,
    queueId: options.queueId,
    queueName: queue.name,
    offerText: options.offerText,
    staffId: options.staffId,
    skipEntryIds: [],
    currentEntryId: first.entryId,
    currentUserId: first.userId,
    offerMessage: null,
  };

  chains.set(options.guildId, chain);
  tokens.set(chain.token, options.guildId);

  try {
    await offerTo(ctx, chain, first);
  } catch (error) {
    release(options.guildId);
    throw error;
  }

  return { queueName: queue.name };
}

export async function resolveSendJo(
  ctx: AppContext,
  token: string,
  userId: string,
  accepted: boolean,
): Promise<"accepted" | "declined"> {
  const chain = chainByToken(token);
  if (!chain) {
    throw new AppError("This offer is no longer active.", "SENDJO_STALE");
  }
  if (chain.currentUserId !== userId) {
    throw new AppError("This offer is not for you.", "SENDJO_FOREIGN");
  }

  if (chain.timer) clearTimeout(chain.timer);

  if (accepted) {
    try {
      const view = dispatchEntry(ctx.db, {
        guildId: chain.guildId,
        entryId: chain.currentEntryId,
        actorId: chain.staffId,
        queueId: chain.queueId,
      });
      ctx.display.schedule(chain.guildId);
      await closeOfferMessage(ctx, chain, "accepted");
      logQueueActivity(ctx, chain.guildId, {
        action: "J.O. accepted",
        userId,
        actorId: chain.staffId,
        detail: chain.queueName,
      });
      await notifyStaff(
        ctx,
        chain.guildId,
        "J.O. accepted",
        `<@${userId}> accepted **${chain.queueName}** and is now **ON DUTY**.`,
      );
      release(chain.guildId);
      ctx.logger.info(
        { guildId: chain.guildId, userId, entryId: view.entry.id },
        "Send-jo accepted",
      );
      return "accepted";
    } catch (error) {
      chain.skipEntryIds.push(chain.currentEntryId);
      await closeOfferMessage(ctx, chain, "declined");
      void continueAfterReject(ctx, chain, "unreachable", userId);
      if (error instanceof AppError) throw error;
      throw new AppError("You are no longer READY for this J.O.", "NOT_READY");
    }
  }

  chain.skipEntryIds.push(chain.currentEntryId);
  await closeOfferMessage(ctx, chain, "declined");
  recordOfferPass(ctx.db, {
    guildId: chain.guildId,
    entryId: chain.currentEntryId,
    actorId: chain.staffId,
    reason: "declined",
  });
  ctx.display.schedule(chain.guildId);
  logQueueActivity(ctx, chain.guildId, {
    action: "J.O. declined",
    userId,
    actorId: chain.staffId,
    detail: chain.queueName,
  });
  void continueAfterReject(ctx, chain, "declined", userId);
  return "declined";
}

function chainByToken(token: string): SendJoChain | undefined {
  const guildId = tokens.get(token);
  if (!guildId) return undefined;
  const chain = chains.get(guildId);
  if (!chain || chain.token !== token) return undefined;
  return chain;
}

function release(guildId: string): void {
  const chain = chains.get(guildId);
  if (!chain) return;
  if (chain.timer) clearTimeout(chain.timer);
  tokens.delete(chain.token);
  chains.delete(guildId);
}

function armTimer(ctx: AppContext, chain: SendJoChain): void {
  if (chain.timer) clearTimeout(chain.timer);
  const token = chain.token;
  chain.timer = setTimeout(() => {
    void onTimeout(ctx, chain.guildId, token).catch((error) => {
      ctx.logger.warn({ err: error, guildId: chain.guildId }, "Send-jo timeout failed");
    });
  }, SEND_JO_TIMEOUT_MS);
}

async function offerTo(
  ctx: AppContext,
  chain: SendJoChain,
  candidate: DutyLineRow,
  alreadyAnnounced = false,
): Promise<void> {
  tokens.delete(chain.token);
  chain.token = randomUUID();
  chain.currentEntryId = candidate.entryId;
  chain.currentUserId = candidate.userId;
  chain.offerMessage = null;
  tokens.set(chain.token, chain.guildId);

  const expiresAt = offerDeadlineUnix();
  const payload = {
    content: `<@${candidate.userId}>`,
    embeds: [sendJoOfferEmbed(chain.queueName, chain.offerText, expiresAt)],
    components: [sendJoOfferButtons(chain.token)],
  };

  try {
    const user = await ctx.client.users.fetch(candidate.userId);
    const dm = await user.send({
      embeds: payload.embeds,
      components: payload.components,
    });
    chain.offerMessage = { channelId: dm.channelId, messageId: dm.id, via: "dm" };
  } catch {
    const posted = await postPanelFallback(ctx, chain, payload);
    if (!posted) {
      chain.skipEntryIds.push(candidate.entryId);
      logQueueActivity(ctx, chain.guildId, {
        action: "J.O. unreachable",
        userId: candidate.userId,
        actorId: chain.staffId,
        detail: chain.queueName,
      });
      await continueAfterReject(ctx, chain, "unreachable", candidate.userId);
      return;
    }
  }

  armTimer(ctx, chain);
  logQueueActivity(ctx, chain.guildId, {
    action: "J.O. offered",
    userId: candidate.userId,
    actorId: chain.staffId,
    detail: chain.queueName,
  });
  if (!alreadyAnnounced) {
    await notifyStaff(
      ctx,
      chain.guildId,
      "J.O. offered",
      `Offering **${chain.queueName}** to <@${candidate.userId}>.`,
    );
  }
}

async function postPanelFallback(
  ctx: AppContext,
  chain: SendJoChain,
  payload: {
    content: string;
    embeds: ReturnType<typeof sendJoOfferEmbed>[];
    components: ReturnType<typeof sendJoOfferButtons>[];
  },
): Promise<boolean> {
  const config = store.getGuild(ctx.db, chain.guildId);
  if (!config?.panelChannelId) return false;
  try {
    const channel = await ctx.client.channels.fetch(config.panelChannelId);
    if (channel?.type !== ChannelType.GuildText) return false;
    const message = await channel.send(payload);
    chain.offerMessage = {
      channelId: channel.id,
      messageId: message.id,
      via: "panel",
    };
    return true;
  } catch (error) {
    ctx.logger.warn(
      { err: error, guildId: chain.guildId },
      "Failed to post send-jo fallback in queue-start",
    );
    return false;
  }
}

async function onTimeout(
  ctx: AppContext,
  guildId: string,
  token: string,
): Promise<void> {
  const chain = chains.get(guildId);
  if (!chain || chain.token !== token) return;

  const previousUserId = chain.currentUserId;
  chain.skipEntryIds.push(chain.currentEntryId);
  await closeOfferMessage(ctx, chain, "timeout");
  recordOfferPass(ctx.db, {
    guildId: chain.guildId,
    entryId: chain.currentEntryId,
    actorId: chain.staffId,
    reason: "timeout",
  });
  ctx.display.schedule(chain.guildId);
  logQueueActivity(ctx, chain.guildId, {
    action: "J.O. timeout",
    userId: previousUserId,
    actorId: chain.staffId,
    detail: chain.queueName,
  });
  await continueAfterReject(ctx, chain, "timeout", previousUserId);
}

async function continueAfterReject(
  ctx: AppContext,
  chain: SendJoChain,
  reason: "declined" | "timeout" | "unreachable",
  previousUserId: string,
): Promise<void> {
  const next = nextReadyForJob(
    ctx.db,
    chain.guildId,
    chain.queueId,
    chain.skipEntryIds,
  );

  if (!next) {
    logQueueActivity(ctx, chain.guildId, {
      action: "J.O. exhausted",
      actorId: chain.staffId,
      detail: chain.queueName,
    });
    await notifyStaff(
      ctx,
      chain.guildId,
      "No one accepted",
      `No one in line accepted this **${chain.queueName}** J.O.`,
    );
    release(chain.guildId);
    return;
  }

  const reasonText =
    reason === "declined"
      ? "declined"
      : reason === "timeout"
        ? "did not respond"
        : "could not be reached";

  await notifyStaff(
    ctx,
    chain.guildId,
    "Offering next",
    `<@${previousUserId}> ${reasonText} — offering <@${next.userId}>.`,
  );
  logQueueActivity(ctx, chain.guildId, {
    action: "J.O. next",
    userId: next.userId,
    actorId: chain.staffId,
    detail: chain.queueName,
  });

  try {
    await offerTo(ctx, chain, next, true);
  } catch (error) {
    ctx.logger.warn({ err: error, guildId: chain.guildId }, "Send-jo continue failed");
    release(chain.guildId);
  }
}

async function closeOfferMessage(
  ctx: AppContext,
  chain: SendJoChain,
  outcome: "accepted" | "declined" | "timeout",
): Promise<void> {
  const ref = chain.offerMessage;
  chain.offerMessage = null;
  if (!ref) return;

  try {
    const channel = await ctx.client.channels.fetch(ref.channelId);
    if (!channel || !channel.isTextBased()) return;
    const message = await channel.messages.fetch(ref.messageId);
    if (ref.via === "panel") {
      await message.delete().catch(() => undefined);
      return;
    }
    const title =
      outcome === "accepted"
        ? "J.O. accepted"
        : outcome === "declined"
          ? "J.O. declined"
          : "J.O. offer expired";
    await message.edit({
      content: "",
      embeds: [infoEmbed(title, "This offer is closed.")],
      components: [],
    });
  } catch {
    // Offer message may already be gone.
  }
}

async function notifyStaff(
  ctx: AppContext,
  guildId: string,
  title: string,
  description: string,
): Promise<void> {
  const config = store.getGuild(ctx.db, guildId);
  if (!config?.adminChannelId) return;
  try {
    const channel = await ctx.client.channels.fetch(config.adminChannelId);
    if (channel?.type !== ChannelType.GuildText) return;
    const embed =
      title === "J.O. accepted"
        ? successEmbed(title, description)
        : title === "No one accepted"
          ? warningEmbed(title, description)
          : infoEmbed(title, description);
    await channel.send({ embeds: [embed] });
  } catch (error) {
    ctx.logger.warn({ err: error, guildId }, "Failed to notify staff about send-jo");
  }
}
