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

/**
 * Writes a Compose document as YAML. Every string value is double quoted, so a value YAML 1.1 could read as something
 * else (22:22, no, yes, 0123, 1e3) stays a string whichever YAML reader opens the file. A key stays plain only when it is
 * letters, digits, underscores and dashes starting with a letter and is not one of the YAML 1.1 words; every other key is
 * double quoted, so a service, volume, network or option name such as 2024-10-04, 1_000, 0b11 or a merge key comes back
 * from Compose's loader as the same text. Lines are never folded, so a long value stays on one line, and no `version` key
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
  return tree.toString({ defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN', lineWidth: 0 });
}
