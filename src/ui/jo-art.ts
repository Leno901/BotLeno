import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AttachmentBuilder, type EmbedBuilder } from "discord.js";

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets");

const FILES = {
  offer: "jo-offer.png",
  accepted: "jo-accepted.png",
  declined: "jo-declined.png",
  timeout: "jo-expired.png",
} as const;

export type JoArtKind = keyof typeof FILES;

export function withJoArt(
  embed: EmbedBuilder,
  kind: JoArtKind,
): { embeds: EmbedBuilder[]; files: AttachmentBuilder[] } {
  const name = FILES[kind];
  const file = join(assetsDir, name);
  if (!existsSync(file)) return { embeds: [embed], files: [] };
  embed.setThumbnail(`attachment://${name}`);
  return {
    embeds: [embed],
    files: [new AttachmentBuilder(file, { name })],
  };
}
