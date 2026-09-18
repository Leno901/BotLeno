import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(level = "info"): Logger {
  const pretty = process.env.NODE_ENV !== "production";
  return pino({
    level,
    redact: {
      paths: [
        "DISCORD_TOKEN",
        "token",
        "password",
        "DATABASE_URL",
        "env.DISCORD_TOKEN",
      ],
      remove: true,
    },
    transport: pretty
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  });
}
