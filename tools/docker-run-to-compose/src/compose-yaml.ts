import { Document, isScalar, visit } from 'yaml';

/** A key that is plainly safe: a letter first, then letters, digits, underscores and dashes. Nothing else is written bare. */
const PLAIN_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Words YAML 1.1 reads as a boolean or null (y, n, yes, no, on, off, true, false, null in any letter case). Compose's own
 * loader follows YAML 1.1 in places, so a key spelled like one of them is quoted even though it looks plain.
 */
const YAML_1_1_WORDS = new Set(['y', 'n', 'yes', 'no', 'on', 'off', 'true', 'false', 'null']);

/**
 * True when a key must be written in double quotes. A key such as 2024-10-04 (a date), 1_000 or 0b11 (integers), a merge
 * key, `~` (null), or a key holding a tab or a line break is read as something other than the text it is by a YAML 1.1
 * reader, and a plain key that holds anything outside letters, digits, underscore and dash is never worth the risk.
 */
function keyNeedsQuotes(key: string): boolean {
  return !PLAIN_KEY.test(key) || YAML_1_1_WORDS.has(key.toLowerCase());
}

/** A backslash and a letter u: how a double-quoted YAML scalar spells a character by its code point. */
const UNICODE_ESCAPE = String.fromCharCode(92) + 'u';

/**
 * True for the characters a YAML reader may treat as a line break (NEL, the line and paragraph separators), refuse (the
 * non-characters at the end of the Unicode range), drop (a byte order mark) or reject (DEL and the C1 controls), so they are
 * never written raw.
 */
function needsEscape(code: number): boolean {
  return (
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0xfeff ||
    code === 0xfffe ||
    code === 0xffff
  );
}

/**
 * Replaces each character that needs it with an escape written as a backslash, the letter u and four hex digits. Every string
 * (and every key that is not plainly safe) is written in double quotes, and those are the only places such a character can
 * be, so the escape is always inside a double-quoted scalar, where YAML 1.1 and 1.2 both read it back as the same character.
 */
function escapeUnusualCharacters(text: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (!needsEscape(code)) continue;
    out += text.slice(from, i) + UNICODE_ESCAPE + code.toString(16).toUpperCase().padStart(4, '0');
    from = i + 1;
  }
  return from === 0 ? text : out + text.slice(from);
}

/**
 * Writes a Compose document as YAML. Every string value is double quoted, so a value YAML 1.1 could read as something
 * else (22:22, no, yes, 0123, 1e3) stays a string whichever YAML reader opens the file. A key stays plain only when it is
 * letters, digits, underscores and dashes starting with a letter and is not one of the YAML 1.1 words; every other key is
 * double quoted, so a service, volume, network or option name such as 2024-10-04, 1_000, 0b11 or a merge key comes back
 * from Compose's loader as the same text. DEL, the C1 controls (including NEL), the line and paragraph separators, a byte
 * order mark and the two non-characters at the end of the Unicode range are written as escapes inside the quotes. Lines are never folded, so a long value stays on one line, and no `version` key
 * is written (Compose ignores it).
 */
export function toComposeYaml(document: unknown): string {
  const tree = new Document(document);
  visit(tree, {
    Pair(_key, pair) {
      const key = pair.key;
      if (isScalar(key) && typeof key.value === 'string' && keyNeedsQuotes(key.value)) key.type = 'QUOTE_DOUBLE';
    },
  });
  return escapeUnusualCharacters(
    tree.toString({ defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN', lineWidth: 0 }),
  );
}
