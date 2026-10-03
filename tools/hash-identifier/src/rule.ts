/**
 * What a rule is, and the documents the rules rest on.
 *
 * A rule never decides which algorithm made a string. It says that the string has the layout a published format gives (a
 * marker, tier 1), a specific shape with no marker (tier 2), or the length of a digest (tier 3), and it says why. The
 * reason names the marker that matched and the fields that were checked; the source names the document the layout comes
 * from or, where no format document was read, the generator output that confirms it.
 */

export type Tier = 1 | 2 | 3;

export interface RuleMatch {
  /** Which marker matched and which fields were checked, in a sentence for the visitor. */
  reason: string;
  /** A tier for this match that differs from the rule's own (the {CRYPT} wrapper is only a marker when its body is checked). */
  tier?: Tier;
}

export interface HashRule {
  /** Stable identifier, used by the tests and by the page. */
  id: string;
  /** The name shown to the visitor. */
  name: string;
  /** 1: a marker and a field layout from a published format. 2: a specific shape. 3: a length only. */
  tier: Tier;
  /** The document the layout comes from. Never empty. */
  source: string;
  /** Returns the reason when the (trimmed, printable ASCII, at most 4,096 character) line fits, otherwise null. */
  test(line: string): RuleMatch | null;
}

export function rule(
  id: string,
  name: string,
  tier: Tier,
  source: string,
  test: (line: string) => string | { reason: string; tier: Tier } | null,
): HashRule {
  return {
    id,
    name,
    tier,
    source,
    test(line: string): RuleMatch | null {
      const result = test(line);
      if (result === null) return null;
      return typeof result === 'string' ? { reason: result } : result;
    },
  };
}

/** The documents the rules cite. */
export const SRC = {
  crypt5: 'libxcrypt crypt(5), "Available hashing methods"',
  phc: 'PHC string format (C2SP phc-strings)',
  rfc9106: 'RFC 9106 (Argon2)',
  rfc2307: 'RFC 2307 section 5.3',
  slappasswd: 'OpenLDAP slappasswd(8)',
  apache: 'Apache HTTP Server, "Password Formats"',
  django: 'Django documentation, "How Django stores passwords"',
  rfc4648: 'RFC 4648',
} as const;
