import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { DEFAULT_TIMEZONE } from "./defaults.js";

loadDotenv();

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  CLIENT_ID: z.string().min(1, "CLIENT_ID is required"),
  DATABASE_PATH: z.string().min(1).default("./data/botleno.sqlite"),
  DEFAULT_TIMEZONE: z.string().min(1).default(DEFAULT_TIMEZONE),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  DEV_GUILD_ID: z
    .string()
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : undefined)),
});

export type Env = z.infer<typeof schema>;

function resolveDatabasePath(): string | undefined {
  if (process.env.DATABASE_PATH?.trim()) {
    return process.env.DATABASE_PATH.trim();
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return undefined;
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse({
    ...source,
    DATABASE_PATH: resolveDatabasePath() ?? source.DATABASE_PATH,
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  return parsed.data;
}
