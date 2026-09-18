const SANS_ITALIC_UPPER = 0x1d608;
const SANS_ITALIC_LOWER = 0x1d622;

export function sansItalic(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code == null) continue;
    if (code >= 65 && code <= 90) {
      out += String.fromCodePoint(SANS_ITALIC_UPPER + (code - 65));
      continue;
    }
    if (code >= 97 && code <= 122) {
      out += String.fromCodePoint(SANS_ITALIC_LOWER + (code - 97));
      continue;
    }
    out += ch;
  }
  return out;
}
