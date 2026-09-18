import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  Events,
  PermissionFlagsBits,
  REST,
  Routes,
  type Client,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import type { AppContext } from "../src/app-context.js";
import {
  commandBodies,
  discordApiCode,
  putGlobalCommands,
  putGuildCommands,
} from "../src/commands/deploy.js";
import { registerReady } from "../src/events/ready.js";
import { createTestDb } from "./helpers.js";

test("command payload includes setup and every loaded slash command", () => {
  const names = commandBodies().map((command) => command.name).sort();
  assert.deepEqual(names, [
    "leavequeue",
    "myqueue",
    "queue",
    "queue-admin",
    "queue-config",
    "send-jo",
    "setup",
  ]);
});

test("setup is hidden from members without Manage Server", () => {
  const commands = commandBodies();
  const setup = commands.find((command) => command.name === "setup");
  assert.equal(setup?.default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
  for (const name of ["queue", "myqueue", "leavequeue"]) {
    const command = commands.find((entry) => entry.name === name);
    assert.equal(command?.default_member_permissions, undefined);
  }
});

test("putGuildCommands writes to that guild, not globally", async () => {
  const routes: string[] = [];
  const rest = {
    async put(route: string) {
      routes.push(route);
      return [];
    },
  } as unknown as REST;
  const body = [{ name: "setup" }] as RESTPostAPIApplicationCommandsJSONBody[];
  await putGuildCommands(rest, "app-id", "guild-2", body);
  assert.equal(routes[0], Routes.applicationGuildCommands("app-id", "guild-2"));
});

test("putGlobalCommands writes application commands", async () => {
  const routes: string[] = [];
  const rest = {
    async put(route: string) {
      routes.push(route);
      return [];
    },
  } as unknown as REST;
  await putGlobalCommands(rest, "app-id", []);
  assert.equal(routes[0], Routes.applicationCommands("app-id"));
});

test("discordApiCode reads Discord REST error codes", () => {
  assert.equal(discordApiCode({ code: 50001 }), 50001);
  assert.equal(discordApiCode({ code: "30034" }), 30034);
  assert.equal(discordApiCode(new Error("nope")), undefined);
});

test("ready clears global commands and registers each guild", async () => {
  const puts: { route: string; body: unknown }[] = [];
  const rest = {
    async put(route: string, options?: { body?: unknown }) {
      puts.push({ route, body: options?.body });
      return [];
    },
  };
  const client = Object.assign(new EventEmitter(), { rest }) as unknown as Client;
  const guild = { id: "guild-1", name: "Test" };
  const ctx = {
    client,
    db: createTestDb(),
    env: { CLIENT_ID: "app-id", DEFAULT_TIMEZONE: "UTC" },
    logger: { info() {}, error() {}, warn() {}, debug() {} },
    display: { schedule() {}, stop() {} },
  } as unknown as AppContext;

  registerReady(client, ctx);
  client.emit(Events.ClientReady, {
    user: { tag: "bot#0000" },
    guilds: { cache: new Map([[guild.id, guild]]) },
  } as never);

  const globalPuts = puts.filter((put) => put.route === Routes.applicationCommands("app-id"));
  const guildPuts = puts.filter(
    (put) => put.route === Routes.applicationGuildCommands("app-id", "guild-1"),
  );
  assert.equal(globalPuts.length, 1);
  assert.deepEqual(globalPuts[0]?.body, []);
  assert.equal(guildPuts.length, 1);
  const names = (guildPuts[0]?.body as { name: string }[]).map((command) => command.name);
  assert.ok(names.includes("setup"));
  assert.ok(names.includes("myqueue"));
});
