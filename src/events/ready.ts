import { Events, type Client } from "discord.js";
import type { AppContext } from "../app-context.js";
import {
  commandBodies,
  discordApiCode,
  putGlobalCommands,
  putGuildCommands,
  syncStaffCommandPermissions,
} from "../commands/deploy.js";
import { inviteUrl } from "../config/defaults.js";
import * as store from "../database/store.js";
import { expireDue } from "../services/queue.js";

export function registerReady(client: Client, ctx: AppContext): void {
  client.once(Events.ClientReady, (readyClient) => {
    ctx.logger.info(
      { user: readyClient.user.tag, guilds: readyClient.guilds.cache.size },
      "Logged in",
    );

    const expired = expireDue(ctx.db, new Date());
    if (expired.length > 0) {
      ctx.logger.info({ count: expired.length }, "Expired stale queue entries on startup");
    }

    const body = commandBodies();
    clearGlobalCommands(ctx);
    for (const guild of readyClient.guilds.cache.values()) {
      store.ensureGuild(ctx.db, guild.id, ctx.env.DEFAULT_TIMEZONE);
      ctx.logger.info({ guildId: guild.id, name: guild.name }, "Guild connected");
      ctx.display.schedule(guild.id);
      deployGuildCommands(ctx, guild, body);
    }
  });

  client.on(Events.GuildCreate, (guild) => {
    store.ensureGuild(ctx.db, guild.id, ctx.env.DEFAULT_TIMEZONE);
    ctx.logger.info({ guildId: guild.id, name: guild.name }, "Joined guild");
    deployGuildCommands(ctx, guild);
  });
}

function clearGlobalCommands(ctx: AppContext): void {
  void putGlobalCommands(ctx.client.rest, ctx.env.CLIENT_ID, [])
    .then(() => ctx.logger.info("Cleared global commands"))
    .catch((error) =>
      ctx.logger.error(
        { err: error, code: discordApiCode(error) },
        "Clearing global commands failed",
      ),
    );
}

function deployGuildCommands(
  ctx: AppContext,
  guild: { id: string; name: string },
  body = commandBodies(),
): void {
  void putGuildCommands(ctx.client.rest, ctx.env.CLIENT_ID, guild.id, body)
    .then(async (commands) => {
      const staffRoleId = store.getGuild(ctx.db, guild.id)?.staffRoleId ?? null;
      await syncStaffCommandPermissions(
        ctx.client.rest,
        ctx.env.CLIENT_ID,
        guild.id,
        commands,
        staffRoleId,
      ).catch((error) => {
        ctx.logger.warn(
          { err: error, guildId: guild.id, code: discordApiCode(error) },
          "Staff command visibility sync failed",
        );
      });
      ctx.logger.info(
        { guildId: guild.id, name: guild.name, count: body.length },
        "Registered guild commands",
      );
    })
    .catch((error) => {
      const code = discordApiCode(error);
      const missingScope = code === 50001;
      ctx.logger.error(
        {
          err: error,
          guildId: guild.id,
          name: guild.name,
          code,
          ...(missingScope ? { invite: inviteUrl(ctx.env.CLIENT_ID) } : {}),
        },
        missingScope
          ? "Re-invite with applications.commands scope"
          : "Guild command deploy failed",
      );
    });
}
