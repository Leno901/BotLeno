import { REST, Routes, type APIApplicationCommand, type RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { loadCommands } from "./loader.js";

export { syncStaffCommandPermissions, STAFF_SLASH_COMMANDS } from "./staff-visibility.js";

export function commandBodies(): RESTPostAPIApplicationCommandsJSONBody[] {
  return [...loadCommands().values()].map((command) => command.data.toJSON());
}

export async function putGuildCommands(
  rest: REST,
  clientId: string,
  guildId: string,
  body: RESTPostAPIApplicationCommandsJSONBody[] = commandBodies(),
): Promise<APIApplicationCommand[]> {
  const result = await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body,
  });
  return Array.isArray(result) ? (result as APIApplicationCommand[]) : [];
}

export async function putGlobalCommands(
  rest: REST,
  clientId: string,
  body: RESTPostAPIApplicationCommandsJSONBody[] = commandBodies(),
): Promise<unknown> {
  return rest.put(Routes.applicationCommands(clientId), { body });
}

export function discordApiCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = error.code;
  if (typeof code === "number" && Number.isFinite(code)) return code;
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  return undefined;
}
