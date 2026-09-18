const SANS_ITALIC_UPPER = 0x1d608;
const SANS_ITALIC_LOWER = 0x1d622;
const DOUBLE_STRUCK_LOWER = 0x1d552;
const DOUBLE_STRUCK_DIGIT = 0x1d7d8;
const DOUBLE_STRUCK_UPPER = [
  0x1d538, 0x1d539, 0x2102, 0x1d53b, 0x1d53c, 0x1d53d, 0x1d53e, 0x210d, 0x1d540,
  0x1d541, 0x1d542, 0x1d543, 0x1d544, 0x2115, 0x1d546, 0x2119, 0x211a, 0x211d,
  0x1d54a, 0x1d54b, 0x1d54c, 0x1d54d, 0x1d54e, 0x1d54f, 0x1d550, 0x2124,
];

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

export function doubleStruck(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code == null) continue;
    if (code >= 65 && code <= 90) {
      out += String.fromCodePoint(DOUBLE_STRUCK_UPPER[code - 65]!);
      continue;
    }
    if (code >= 97 && code <= 122) {
      out += String.fromCodePoint(DOUBLE_STRUCK_LOWER + (code - 97));
      continue;
    }
    if (code >= 48 && code <= 57) {
      out += String.fromCodePoint(DOUBLE_STRUCK_DIGIT + (code - 48));
      continue;
    }
    out += ch;
  }
  return out;
}
