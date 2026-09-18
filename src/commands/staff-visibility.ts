import {
  ApplicationCommandPermissionType,
  REST,
  Routes,
  type APIApplicationCommand,
} from "discord.js";

export const STAFF_SLASH_COMMANDS = new Set([
  "setup",
  "queue-config",
  "queue-admin",
  "queue-clear-all",
  "send-jo",
]);

export async function syncStaffCommandPermissions(
  rest: REST,
  clientId: string,
  guildId: string,
  commands: APIApplicationCommand[],
  staffRoleId: string | null,
): Promise<void> {
  if (!staffRoleId) return;
  for (const command of commands) {
    if (!STAFF_SLASH_COMMANDS.has(command.name)) continue;
    await rest.put(Routes.applicationCommandPermissions(clientId, guildId, command.id), {
      body: {
        permissions: [
          {
            id: staffRoleId,
            type: ApplicationCommandPermissionType.Role,
            permission: true,
          },
        ],
      },
    });
  }
}
