import {
  ChannelType,
  PermissionFlagsBits,
  type CategoryChannel,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type OverwriteResolvable,
  type Role,
  type TextChannel,
} from "discord.js";
import {
  DEFAULT_ADMIN_CHANNEL,
  DEFAULT_CATEGORY_NAME,
  DEFAULT_LOGS_CHANNEL,
  DEFAULT_PANEL_CHANNEL,
  DEFAULT_STAFF_ROLE_NAME,
  DEFAULT_STATUS_CATEGORY_NAME,
  DEFAULT_STATUS_CHANNEL,
  LEGACY_CATEGORY_NAME,
  LEGACY_PANEL_CHANNEL,
  LEGACY_STATUS_CHANNEL,
  PERSONAL_STATUS_CHANNELS_ENABLED,
} from "../config/defaults.js";
import type { AppContext } from "../app-context.js";
import * as store from "../database/store.js";
import {
  isGuildManager,
  missingPermissionNames,
} from "./permissions.js";
import {
  planSetup,
  setupReport,
  type NamedResource,
  type ResourceProbe,
  type SetupResourceKey,
} from "./setup-plan.js";
import { AppError } from "./errors.js";
import { ensureStatusCategory, syncUserStatusChannels } from "./user-status-channel.js";
import {
  errorEmbed,
  missingSetupPermissionsEmbed,
  queuePanelEmbed,
  roleHierarchyEmbed,
  setupResultEmbed,
} from "../ui/embeds.js";
import { queueSelectRow } from "../ui/components.js";
import { listQueueBoard, listDutyLine } from "./queue.js";
import { upsertDutyLineMessage } from "./display.js";
import { ephemeral, safeReply } from "../utils/reply.js";
import { syncStaffCommandPermissions } from "../commands/staff-visibility.js";

const TEXT_PERMS = {
  view: PermissionFlagsBits.ViewChannel,
  send: PermissionFlagsBits.SendMessages,
  embed: PermissionFlagsBits.EmbedLinks,
  history: PermissionFlagsBits.ReadMessageHistory,
  manageMessages: PermissionFlagsBits.ManageMessages,
  addReactions: PermissionFlagsBits.AddReactions,
} as const;

function asNamed(resource: { id: string; name: string } | null): NamedResource | null {
  return resource ? { id: resource.id, name: resource.name } : null;
}

async function fetchText(
  guild: Guild,
  id: string | null,
): Promise<TextChannel | null> {
  if (!id) return null;
  try {
    const channel = await guild.channels.fetch(id);
    return channel?.type === ChannelType.GuildText ? channel : null;
  } catch {
    return null;
  }
}

async function fetchCategory(
  guild: Guild,
  id: string | null,
): Promise<CategoryChannel | null> {
  if (!id) return null;
  try {
    const channel = await guild.channels.fetch(id);
    return channel?.type === ChannelType.GuildCategory ? channel : null;
  } catch {
    return null;
  }
}

async function fetchRole(guild: Guild, id: string | null): Promise<Role | null> {
  if (!id) return null;
  try {
    return await guild.roles.fetch(id);
  } catch {
    return null;
  }
}

function findTextByName(
  guild: Guild,
  name: string,
  parentId?: string | null,
): TextChannel | null {
  const match = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.name === name &&
      (parentId ? channel.parentId === parentId : true),
  );
  return match?.type === ChannelType.GuildText ? match : null;
}

function findCategoryByName(guild: Guild, name: string): CategoryChannel | null {
  const match = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === name,
  );
  return match?.type === ChannelType.GuildCategory ? match : null;
}

export async function runSetup(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.inCachedGuild() || !interaction.guild || !interaction.member) {
    await safeReply(
      interaction,
      ephemeral({
        embeds: [errorEmbed("Guild only", "Run `/setup` inside a Discord server.")],
      }),
    );
    return;
  }

  const guild = interaction.guild;
  const member = interaction.member;
  const botMember = guild.members.me;

  if (!isGuildManager(member.permissions.bitfield)) {
    await safeReply(
      interaction,
      ephemeral({
        embeds: [
          errorEmbed(
            "❌ Missing User Permission",
            "You need **Manage Server** to run `/setup`.",
          ),
        ],
      }),
    );
    return;
  }

  if (!botMember) {
    await safeReply(
      interaction,
      ephemeral({
        embeds: [errorEmbed("Bot member not found", "Re-invite the bot and try again.")],
      }),
    );
    return;
  }

  const missing = missingPermissionNames(botMember.permissions.bitfield);
  if (missing.length > 0) {
    ctx.logger.warn({ guildId: guild.id, missing }, "Missing setup permissions");
    await safeReply(
      interaction,
      ephemeral({ embeds: [missingSetupPermissionsEmbed(missing)] }),
    );
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guildConfig = store.ensureGuild(
    ctx.db,
    guild.id,
    ctx.env.DEFAULT_TIMEZONE,
  );

  const categoryById = await fetchCategory(guild, guildConfig.categoryId);
  const categoryByName =
    categoryById ??
    findCategoryByName(guild, DEFAULT_CATEGORY_NAME) ??
    findCategoryByName(guild, LEGACY_CATEGORY_NAME);

  const staffById = await fetchRole(guild, guildConfig.staffRoleId);
  const staffByName =
    staffById ??
    guild.roles.cache.find((role) => role.name === DEFAULT_STAFF_ROLE_NAME) ??
    null;

  const panelById = await fetchText(guild, guildConfig.panelChannelId);
  const statusById = await fetchText(guild, guildConfig.statusChannelId);
  const adminById = await fetchText(guild, guildConfig.adminChannelId);
  const logsById = await fetchText(guild, guildConfig.logsChannelId);

  const parentId = categoryById?.id ?? categoryByName?.id ?? null;
  const panelByName =
    panelById ??
    findTextByName(guild, DEFAULT_PANEL_CHANNEL, parentId) ??
    findTextByName(guild, LEGACY_PANEL_CHANNEL, parentId);
  const statusByName =
    statusById ??
    findTextByName(guild, DEFAULT_STATUS_CHANNEL, parentId) ??
    findTextByName(guild, LEGACY_STATUS_CHANNEL, parentId);
  const adminByName =
    adminById ?? findTextByName(guild, DEFAULT_ADMIN_CHANNEL, parentId);
  const logsByName =
    logsById ?? findTextByName(guild, DEFAULT_LOGS_CHANNEL, parentId);

  const probes: ResourceProbe[] = [
    {
      key: "category",
      storedId: guildConfig.categoryId,
      byId: asNamed(categoryById),
      byName: asNamed(categoryByName),
    },
  ];
  if (PERSONAL_STATUS_CHANNELS_ENABLED) {
    const statusCategoryById = await fetchCategory(guild, guildConfig.statusCategoryId);
    const statusCategoryByName =
      statusCategoryById ??
      (guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildCategory &&
          channel.name === DEFAULT_STATUS_CATEGORY_NAME,
      ) as CategoryChannel | undefined) ??
      null;
    probes.push({
      key: "statusCategory",
      storedId: guildConfig.statusCategoryId,
      byId: asNamed(statusCategoryById),
      byName: asNamed(statusCategoryByName),
    });
  }
  probes.push(
    {
      key: "panel",
      storedId: guildConfig.panelChannelId,
      byId: asNamed(panelById),
      byName: asNamed(panelByName),
    },
    {
      key: "status",
      storedId: guildConfig.statusChannelId,
      byId: asNamed(statusById),
      byName: asNamed(statusByName),
    },
    {
      key: "admin",
      storedId: guildConfig.adminChannelId,
      byId: asNamed(adminById),
      byName: asNamed(adminByName),
    },
    {
      key: "logs",
      storedId: guildConfig.logsChannelId,
      byId: asNamed(logsById),
      byName: asNamed(logsByName),
    },
    {
      key: "staffRole",
      storedId: guildConfig.staffRoleId,
      byId: asNamed(staffById),
      byName: asNamed(staffByName),
    },
  );

  const decisions = planSetup(probes);
  const report = setupReport(decisions);
  const ids: Partial<Record<SetupResourceKey, string>> = {};
  for (const decision of decisions) {
    if (decision.id) ids[decision.key] = decision.id;
  }

  try {
    if (!ids.staffRole) {
      const created = await guild.roles.create({
        name: DEFAULT_STAFF_ROLE_NAME,
        mentionable: false,
        hoist: false,
        reason: "BotLenoAPP setup",
      });
      ids.staffRole = created.id;
    } else {
      const role = guild.roles.cache.get(ids.staffRole);
      if (role && !role.editable && role.id !== guild.id) {
        if (botMember.roles.highest.comparePositionTo(role) <= 0) {
          await interaction.editReply({
            embeds: [roleHierarchyEmbed(role.name)],
          });
          return;
        }
      }
    }

    const staffRole = await guild.roles.fetch(ids.staffRole);
    if (!staffRole) {
      throw new AppError("Failed to resolve the staff role.", "SETUP_FAILED", "error");
    }

    if (!ids.category) {
      const created = await guild.channels.create({
        name: DEFAULT_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        reason: "BotLenoAPP setup",
      });
      ids.category = created.id;
    }

    const category = await guild.channels.fetch(ids.category);
    if (!category || category.type !== ChannelType.GuildCategory) {
      throw new AppError("Failed to resolve the LenQ category.", "SETUP_FAILED", "error");
    }

    if (category.name === LEGACY_CATEGORY_NAME) {
      await category.setName(DEFAULT_CATEGORY_NAME, "LenQ category rename").catch(() => undefined);
    }

    const botRole = botMember.roles.botRole ?? botMember.roles.highest;

    if (!ids.panel) {
      const created = await guild.channels.create({
        name: DEFAULT_PANEL_CHANNEL,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: "Join a BotLenoAPP job queue",
        reason: "BotLenoAPP setup",
        permissionOverwrites: panelOverwrites(guild, botRole, staffRole),
      });
      ids.panel = created.id;
    }

    if (!ids.status) {
      const created = await guild.channels.create({
        name: DEFAULT_STATUS_CHANNEL,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: "Live J.O. dashboard",
        reason: "BotLenoAPP setup",
        permissionOverwrites: statusOverwrites(guild, botRole, staffRole),
      });
      ids.status = created.id;
    }

    if (!ids.admin) {
      const created = await guild.channels.create({
        name: DEFAULT_ADMIN_CHANNEL,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: "Staff queue controls",
        reason: "BotLenoAPP setup",
        permissionOverwrites: adminOverwrites(guild, botRole, staffRole),
      });
      ids.admin = created.id;
    }

    if (!ids.logs) {
      const created = await guild.channels.create({
        name: DEFAULT_LOGS_CHANNEL,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: "Read-only queue activity log",
        reason: "BotLenoAPP setup",
        permissionOverwrites: logsOverwrites(guild, botRole, staffRole),
      });
      ids.logs = created.id;
    }

    await repairChannelPerms(
      guild,
      ids.panel!,
      panelOverwrites(guild, botRole, staffRole),
    );
    await repairChannelPerms(
      guild,
      ids.status!,
      statusOverwrites(guild, botRole, staffRole),
    );
    await repairChannelPerms(
      guild,
      ids.admin!,
      adminOverwrites(guild, botRole, staffRole),
    );
    await repairChannelPerms(
      guild,
      ids.logs!,
      logsOverwrites(guild, botRole, staffRole),
    );

    if (PERSONAL_STATUS_CHANNELS_ENABLED) {
      const statusCategory = await ensureStatusCategory(ctx, guild);
      if (!statusCategory) {
        throw new AppError(
          "Failed to resolve the private queue-status category.",
          "SETUP_FAILED",
          "error",
        );
      }
      ids.statusCategory = statusCategory.id;
    }

    store.updateGuild(ctx.db, guild.id, {
      staffRoleId: ids.staffRole,
      categoryId: ids.category,
      ...(PERSONAL_STATUS_CHANNELS_ENABLED
        ? { statusCategoryId: ids.statusCategory ?? null }
        : {}),
      panelChannelId: ids.panel,
      statusChannelId: ids.status,
      adminChannelId: ids.admin,
      logsChannelId: ids.logs,
    });
    if (!PERSONAL_STATUS_CHANNELS_ENABLED) {
      await syncUserStatusChannels(ctx, guild);
    }
    store.seedDefaultQueues(ctx.db, guild.id);

    const queues = listQueueBoard(ctx.db, guild.id);
    const dashboard = listDutyLine(ctx.db, guild.id);
    const timezone = store.getGuild(ctx.db, guild.id)?.timezone ?? ctx.env.DEFAULT_TIMEZONE;
    const panelChannel = await fetchText(guild, ids.panel!);
    const statusChannel = await fetchText(guild, ids.status!);
    const adminChannel = await fetchText(guild, ids.admin!);

    if (panelChannel && panelChannel.name === LEGACY_PANEL_CHANNEL) {
      await panelChannel
        .setName(DEFAULT_PANEL_CHANNEL, "BotLenoAPP queue start")
        .catch(() => undefined);
    }

    if (statusChannel && statusChannel.name === LEGACY_STATUS_CHANNEL) {
      await statusChannel
        .setName(DEFAULT_STATUS_CHANNEL, "BotLenoAPP live dashboard")
        .catch(() => undefined);
    }

    if (panelChannel) {
      const panelPayload = {
        embeds: [queuePanelEmbed(queues)],
        components: queues.length ? [queueSelectRow(queues)] : [],
      };
      const existing = guildConfig.panelMessageId
        ? await panelChannel.messages.fetch(guildConfig.panelMessageId).catch(() => null)
        : null;
      const message = existing
        ? await existing.edit(panelPayload)
        : await panelChannel.send(panelPayload);
      await message.pin().catch(() => undefined);
      store.updateGuild(ctx.db, guild.id, { panelMessageId: message.id });
    }

    if (statusChannel) {
      const messageId = await upsertDutyLineMessage(
        statusChannel,
        guildConfig.statusMessageId,
        dashboard,
        timezone,
      );
      store.updateGuild(ctx.db, guild.id, { statusMessageId: messageId });
    }

    if (adminChannel) {
      const intro = await adminChannel.messages.fetch({ limit: 10 }).catch(() => null);
      const alreadyPosted = intro?.some(
        (message) => message.author.id === ctx.client.user?.id,
      );
      if (!alreadyPosted) {
        await adminChannel.send({
          embeds: [
            setupResultEmbed({
              title: "🔒 Queue Admin",
              lines: [
                "Use `/queue-admin` to manage queues.",
                "Use `/send-jo` to offer a J.O. down the duty line.",
                "Skip, complete, pause, and clear from the staff panel.",
              ],
              note: "This channel is hidden from regular members.",
            }),
          ],
        });
      }
    }

    const createdCount = decisions.filter((decision) => decision.action === "create").length;
    const title = report.firstRun
      ? "Creating BotLenoAPP..."
      : report.fullyConfigured
        ? "BotLenoAPP is already configured."
        : "BotLenoAPP Setup Check";
    const note = report.firstRun
      ? "Setup complete."
      : createdCount === 0
        ? "No duplicates were created."
        : "Missing components were recreated. No duplicates were created.";

    const lines = decisions.map((decision) => {
      if (decision.action === "create") {
        return `✓ ${label(decision.key)} created`;
      }
      return `✓ ${label(decision.key)} found`;
    });

    ctx.logger.info(
      { guildId: guild.id, createdCount, fullyConfigured: report.fullyConfigured },
      "Setup finished",
    );

    try {
      const { putGuildCommands } = await import("../commands/deploy.js");
      const commands = await putGuildCommands(ctx.client.rest, ctx.env.CLIENT_ID, guild.id);
      await syncStaffCommandPermissions(
        ctx.client.rest,
        ctx.env.CLIENT_ID,
        guild.id,
        commands,
        ids.staffRole ?? null,
      );
    } catch (error) {
      ctx.logger.warn(
        { err: error, guildId: guild.id },
        "Staff command visibility sync failed",
      );
    }

    await interaction.editReply({
      embeds: [setupResultEmbed({ title, lines, note })],
    });
  } catch (error) {
    ctx.logger.error({ err: error, guildId: guild.id }, "Setup failed");
    const message =
      error instanceof AppError
        ? error.message
        : "Setup failed while talking to Discord. Check bot permissions and try again.";
    await interaction.editReply({
      embeds: [errorEmbed("❌ Setup Failed", message)],
    });
  }
}

function label(key: SetupResourceKey): string {
  switch (key) {
    case "category":
      return "Category";
    case "statusCategory":
      return "Status category";
    case "panel":
      return "Queue start";
    case "status":
      return "Queue dashboard";
    case "admin":
      return "Queue admin";
    case "logs":
      return "Queue logs";
    case "staffRole":
      return "Staff role";
  }
}

function panelOverwrites(guild: Guild, botRole: Role, staffRole: Role): OverwriteResolvable[] {
  return [
    {
      id: guild.id,
      allow: [TEXT_PERMS.view, TEXT_PERMS.history],
      deny: [TEXT_PERMS.send],
    },
    {
      id: botRole.id,
      allow: [
        TEXT_PERMS.view,
        TEXT_PERMS.send,
        TEXT_PERMS.embed,
        TEXT_PERMS.history,
        TEXT_PERMS.manageMessages,
      ],
    },
    {
      id: staffRole.id,
      allow: [TEXT_PERMS.view, TEXT_PERMS.history, TEXT_PERMS.send],
    },
  ];
}

function statusOverwrites(guild: Guild, botRole: Role, staffRole: Role): OverwriteResolvable[] {
  return panelOverwrites(guild, botRole, staffRole);
}

function adminOverwrites(guild: Guild, botRole: Role, staffRole: Role): OverwriteResolvable[] {
  return [
    {
      id: guild.id,
      deny: [TEXT_PERMS.view],
    },
    {
      id: botRole.id,
      allow: [
        TEXT_PERMS.view,
        TEXT_PERMS.send,
        TEXT_PERMS.embed,
        TEXT_PERMS.history,
        TEXT_PERMS.manageMessages,
      ],
    },
    {
      id: staffRole.id,
      allow: [TEXT_PERMS.view, TEXT_PERMS.send, TEXT_PERMS.history, TEXT_PERMS.embed],
    },
  ];
}

function logsOverwrites(guild: Guild, botRole: Role, staffRole: Role): OverwriteResolvable[] {
  return [
    {
      id: guild.id,
      deny: [
        TEXT_PERMS.view,
        TEXT_PERMS.send,
        TEXT_PERMS.manageMessages,
        TEXT_PERMS.addReactions,
      ],
    },
    {
      id: botRole.id,
      allow: [
        TEXT_PERMS.view,
        TEXT_PERMS.send,
        TEXT_PERMS.embed,
        TEXT_PERMS.history,
      ],
    },
    {
      id: staffRole.id,
      allow: [TEXT_PERMS.view, TEXT_PERMS.history],
      deny: [TEXT_PERMS.send, TEXT_PERMS.manageMessages, TEXT_PERMS.addReactions],
    },
  ];
}

async function repairChannelPerms(
  guild: Guild,
  channelId: string,
  overwrites: OverwriteResolvable[],
): Promise<void> {
  const channel = await fetchText(guild, channelId);
  if (!channel) return;
  await channel.permissionOverwrites.set(overwrites, "BotLenoAPP setup repair");
}

export function requireGuildManager(member: GuildMember): void {
  if (!isGuildManager(member.permissions.bitfield)) {
    throw new AppError(
      "You need **Manage Server** to change BotLenoAPP configuration.",
      "FORBIDDEN",
      "error",
    );
  }
}
