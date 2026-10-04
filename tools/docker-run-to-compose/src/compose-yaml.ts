import { stringify } from 'yaml';

/**
 * Writes a Compose document as YAML. Every string value is double quoted, so a value YAML 1.1 could read as something
 * else (22:22, no, yes, 0123, 1e3) stays a string whichever YAML reader opens the file; keys stay plain, and the library
 * quotes a key only when it must. Lines are never folded, so a long value stays on one line, and no `version` key is
 * written (Compose ignores it).
 */
export function toComposeYaml(document: unknown): string {
  return stringify(document, { defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN', lineWidth: 0 });
}
