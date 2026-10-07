import { STRING_OCTETS } from './limits';

/** The octets one character takes in UTF-8 (a lone surrogate is written as U+FFFD, three octets). */
function utf8Octets(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return 3;
  return codePoint < 0x10000 ? 3 : 4;
}

/** A character as it is written between quotes in a zone file: a quote, a backslash and a control character are escaped. */
function escaped(ch: string, codePoint: number): string {
  if (ch === '"' || ch === '\\') return '\\' + ch;
  if (codePoint < 0x20 || codePoint === 0x7f) return '\\' + String(codePoint).padStart(3, '0');
  return ch;
}

/**
 * The record as a zone-file TXT line: `<name> IN TXT "<text>"`. A text longer than 255 octets (one character-string holds at
 * most 255, RFC 1035 section 3.3) is written as several quoted strings, one per line inside parentheses, the way RFC 9989
 * Appendix B writes them. The strings join with no space added, so a split may fall inside a term. A split never falls inside
 * a character, and an escape (a quote, a backslash or a control character) counts as the one octet it stands for.
 */
export function toZoneForm(name: string, text: string): string {
  const strings: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of text) {
    const codePoint = ch.codePointAt(0) ?? 0;
    const size = utf8Octets(codePoint);
    if (octets + size > STRING_OCTETS) {
      strings.push(current);
      current = '';
      octets = 0;
    }
    current += escaped(ch, codePoint);
    octets += size;
  }
  strings.push(current);
  const first = strings[0] ?? '';
  if (strings.length === 1) return `${name} IN TXT "${first}"`;
  return `${name} IN TXT (\n${strings.map((s) => `  "${s}"`).join('\n')} )`;
}
