import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import type { AppContext } from "../app-context.js";
import { Ids, parseSendJoButton } from "./ids.js";
import {
  handleAfk,
  handleJoinModal,
  handleJoinOpen,
  handleLeaveCancel,
  handleLeaveConfirm,
  handleLeavePrompt,
  handleLineup,
  handleQueueSelect,
  showMyStatus,
} from "./user.js";
import {
  handleAdminButton,
  handleAdminEntrySelect,
  handleAdminQueueSelect,
} from "./admin.js";
import {
  handleSendJoButton,
  handleSendJoModal,
  handleSendJoSelect,
} from "./send-jo.js";
import { replyAppError } from "../utils/reply.js";

export async function handleButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  try {
    switch (interaction.customId) {
      case Ids.joinOpen:
        await handleJoinOpen(interaction, ctx);
        return;
      case Ids.afk:
        await handleAfk(interaction, ctx);
        return;
      case Ids.lineup:
        await handleLineup(interaction, ctx);
        return;
      case Ids.refresh:
      case Ids.myStatus:
        await showMyStatus(interaction, ctx);
        return;
      case Ids.leave:
        await handleLeavePrompt(interaction, ctx);
        return;
      case Ids.leaveConfirm:
        await handleLeaveConfirm(interaction, ctx);
        return;
      case Ids.leaveCancel:
        await handleLeaveCancel(interaction, ctx);
        return;
      default: {
        const sendJo = parseSendJoButton(interaction.customId);
        if (sendJo) {
          await handleSendJoButton(interaction, ctx, sendJo);
          return;
        }
        if (interaction.customId.startsWith("admin:")) {
          await handleAdminButton(interaction, ctx);
        }
      }
    }
  } catch (error) {
    await replyAppError(interaction, error, ctx.logger, ctx.db);
  }
}

export async function handleSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  try {
    if (interaction.customId === Ids.selectQueue) {
      await handleQueueSelect(interaction, ctx);
      return;
    }
    if (interaction.customId === Ids.adminSelectQueue) {
      await handleAdminQueueSelect(interaction, ctx);
      return;
    }
    if (interaction.customId === Ids.adminSelectEntry) {
      await handleAdminEntrySelect(interaction, ctx);
      return;
    }
    if (interaction.customId === Ids.sendJoSelect) {
      await handleSendJoSelect(interaction, ctx);
    }
  } catch (error) {
    await replyAppError(interaction, error, ctx.logger, ctx.db);
  }
}

export async function handleModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  try {
    if (
      interaction.customId === Ids.joinModal ||
      interaction.customId.startsWith(Ids.joinModalPrefix)
    ) {
      await handleJoinModal(interaction, ctx);
      return;
    }
    if (interaction.customId === Ids.sendJoModal) {
      await handleSendJoModal(interaction, ctx);
    }
  } catch (error) {
    await replyAppError(interaction, error, ctx.logger, ctx.db);
  }
}
