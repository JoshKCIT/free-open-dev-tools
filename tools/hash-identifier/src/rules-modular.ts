import { rule, SRC, type HashRule } from './rule';
import { DIGITS, ITOA, only } from './scan';

/**
 * Rules for strings that carry their own marker: the modular crypt formats of libxcrypt crypt(5), phpass, the PHC string
 * format and the Passlib formats. Each rule is a fixed-length comparison, a limited split or a bounded character-class
 * scan, so its cost grows in proportion to the length of the line.
 */

/**
 * The bcrypt layout of crypt(5), `\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}`, written as a fixed-length comparison starting at
 * index `at` (so a prefix such as Django's `bcrypt$` can be skipped without copying the line).
 */
export function bcryptAt(line: string, at = 0): { variant: string; cost: string } | null {
  if (line.length !== at + 60) return null;
  if (line.charCodeAt(at) !== 36 || line.charCodeAt(at + 1) !== 50) return null; // "$2"
  const variant = line.charAt(at + 2);
  if (variant !== 'a' && variant !== 'b' && variant !== 'x' && variant !== 'y') return null;
  if (line.charCodeAt(at + 3) !== 36 || line.charCodeAt(at + 6) !== 36) return null;
  if (!only(line, DIGITS, at + 4, at + 6)) return null;
  if (!only(line, ITOA, at + 7, at + 60)) return null;
  return { variant: `2${variant}`, cost: line.slice(at + 4, at + 6) };
}

/** The sentence that says which marker, cost and fields a bcrypt string was checked for. */
export function bcryptReason(found: { variant: string; cost: string }, lead: string): string {
  const cost = Number(found.cost);
  const range = cost >= 4 && cost <= 31 ? '' : ', outside the 4 to 31 the format allows';
  const note =
    found.variant === '2y'
      ? ' ($2y$ is the same as $2b$ and exists for historical reasons)'
      : found.variant === '2a' || found.variant === '2x'
        ? ' ($2a$ and $2x$ keep compatibility with an older implementation that mishandled characters with the eighth bit set)'
        : '';
  return `${lead}$${found.variant}$, the bcrypt marker${note}, a cost of ${found.cost} (two digits${range}), then 53 characters from ./A-Za-z0-9: a 22-character salt and a 31-character hash.`;
}

const bcrypt = rule('bcrypt', 'bcrypt', 1, SRC.crypt5, (line) => {
  const found = bcryptAt(line);
  return found === null ? null : bcryptReason(found, 'Starts with ');
});

const md5crypt = rule('md5crypt', 'MD5 crypt ($1$)', 1, SRC.crypt5, (line) => {
  if (!line.startsWith('$1$')) return null;
  const end = line.indexOf('$', 3);
  if (end < 4 || end - 3 > 8) return null; // a salt of 1 to 8 characters
  if (line.length - (end + 1) !== 22 || !only(line, ITOA, end + 1, line.length)) return null;
  const salt = line.slice(3, end);
  if (salt.includes(':') || salt.includes('\n')) return null;
  return `Starts with $1$, the MD5 crypt marker, then a salt of ${salt.length} characters (1 to 8 are allowed), a $ and a 22-character hash from ./0-9A-Za-z.`;
});

/** The modular and PHC rules, in the order of the rule table. */
export const MODULAR_RULES: readonly HashRule[] = [bcrypt, md5crypt];
