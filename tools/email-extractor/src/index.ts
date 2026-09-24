import meta from './meta.json';

export { meta };

export type PatternKind = 'email' | 'url' | 'ipv4' | 'ipv6' | 'phone';

/** The five kinds this tool looks for, in the order results are reported when they tie on position. */
export const PATTERN_KINDS: PatternKind[] = ['email', 'url', 'ipv4', 'ipv6', 'phone'];

export interface Extracted {
  kind: PatternKind;
  value: string;
  index: number;
  count: number;
}

export interface ExtractOptions {
  /** Which kinds to look for. Default: all five. */
  kinds?: PatternKind[];
  /** Collapse repeated identical (kind, value) pairs into one entry with a count. Default true. */
  dedupe?: boolean;
}

interface RawMatch {
  kind: PatternKind;
  value: string;
  index: number;
}

// ---------------------------------------------------------------- email (RFC 5322)

// atext, RFC 5322 section 3.2.3: ALPHA / DIGIT / "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" /
// "-" / "/" / "=" / "?" / "^" / "_" / "`" / "{" / "|" / "}" / "~"
const ATEXT = "[A-Za-z0-9!#$%&'*+\\-/=?^_`{|}~]";
// dot-atom-text, section 3.2.3: 1*atext *("." 1*atext)
const LOCAL_PART = `${ATEXT}+(?:\\.${ATEXT}+)*`;
// A LDH label (letters, digits, internal hyphens), out of scope for quoted-string or
// domain-literal forms per this tool's own `limits`.
const DOMAIN_LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
// At least one dot-separated label before a letters-only TLD of two or more characters.
const EMAIL_DOMAIN = `(?:${DOMAIN_LABEL}\\.)+[A-Za-z]{2,}`;
const EMAIL_RE = new RegExp(`${LOCAL_PART}@${EMAIL_DOMAIN}`, 'g');

function findEmails(text: string): RawMatch[] {
  const out: RawMatch[] = [];
  for (const m of text.matchAll(EMAIL_RE)) {
    out.push({ kind: 'email', value: m[0], index: m.index });
  }
  return out;
}

// ---------------------------------------------------------------- url (RFC 3986)

// pchar plus "/", "?" and the scheme separator, RFC 3986 Appendix A: unreserved / pct-encoded /
// sub-delims / ":" / "@", where sub-delims includes "(" and ")" -- a URL may legitimately
// contain a balanced parenthesis pair.
const URL_CANDIDATE_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;

/**
 * Trims trailing sentence punctuation and an unbalanced closing parenthesis or bracket,
 * repeating until neither applies. "a_(b))" (one open, two close) loses the extra ")" and keeps
 * the balanced pair; "x)." loses the period, then the unmatched ")".
 */
function trimUrlTrailer(url: string): string {
  let current = url;
  for (;;) {
    const withoutPunctuation = current.replace(/[.,;:!?]+$/, '');
    if (withoutPunctuation !== current) {
      current = withoutPunctuation;
      continue;
    }
    if (current.endsWith(')')) {
      const opens = (current.match(/\(/g) ?? []).length;
      const closes = (current.match(/\)/g) ?? []).length;
      if (opens < closes) {
        current = current.slice(0, -1);
        continue;
      }
    }
    if (current.endsWith(']')) {
      const opens = (current.match(/\[/g) ?? []).length;
      const closes = (current.match(/\]/g) ?? []).length;
      if (opens < closes) {
        current = current.slice(0, -1);
        continue;
      }
    }
    return current;
  }
}

function findUrls(text: string): RawMatch[] {
  const out: RawMatch[] = [];
  for (const m of text.matchAll(URL_CANDIDATE_RE)) {
    const trimmed = trimUrlTrailer(m[0]);
    if (trimmed !== '') out.push({ kind: 'url', value: trimmed, index: m.index });
  }
  return out;
}

// ---------------------------------------------------------------- ipv4

/** Four decimal octets 0-255, no leading zeros (RFC 3986 Appendix A dec-octet already excludes them). */
export function isIPv4(text: string): boolean {
  const parts = text.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    if (Number(part) > 255) return false;
  }
  return true;
}

// A maximal run of digits and dots, bounded so it is never part of a longer digit-or-dot run.
const IPV4_CANDIDATE_RE = /(?<![0-9.])[0-9.]+(?![0-9.])/g;

function findIpv4(text: string): RawMatch[] {
  const out: RawMatch[] = [];
  for (const m of text.matchAll(IPV4_CANDIDATE_RE)) {
    const candidate = m[0];
    if (isIPv4(candidate)) {
      out.push({ kind: 'ipv4', value: candidate, index: m.index });
      continue;
    }
    // A trailing sentence period is not part of the address; try once without it.
    if (candidate.endsWith('.')) {
      const trimmed = candidate.slice(0, -1);
      if (isIPv4(trimmed)) out.push({ kind: 'ipv4', value: trimmed, index: m.index });
    }
  }
  return out;
}

// ---------------------------------------------------------------- ipv6 (RFC 4291 section 2.2)

/**
 * Validates a full string as an RFC 4291 section 2.2 text representation: "::" stands for one or
 * more groups of 16 zero bits and may appear at most once; a trailing embedded IPv4 tail
 * (x:x:x:x:x:x:d.d.d.d) becomes two hex groups. Zone identifiers (RFC 4007) are out of scope --
 * candidate scanning already stops at "%", so a zoned address is validated as its unzoned prefix.
 */
export function isIPv6(text: string): boolean {
  let input = text.trim();
  if (input === '') return false;

  const v4Match = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(input);
  if (v4Match) {
    const v4Text = v4Match[1]!;
    if (!isIPv4(v4Text)) return false;
    const octets = v4Text.split('.').map(Number);
    const high = (((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16);
    const low = (((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16);
    input = input.slice(0, v4Match.index + 1) + high + ':' + low;
  }

  const doubleColon = input.indexOf('::');
  if (doubleColon !== -1 && input.indexOf('::', doubleColon + 1) !== -1) return false;

  let groups: string[];
  if (doubleColon === -1) {
    groups = input.split(':');
    if (groups.length !== 8) return false;
  } else {
    const head = input
      .slice(0, doubleColon)
      .split(':')
      .filter((g) => g !== '');
    const tail = input
      .slice(doubleColon + 2)
      .split(':')
      .filter((g) => g !== '');
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return false;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  }

  return groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g));
}

// A maximal run of hex digits, colons and dots, bounded so it is never part of a longer such run.
const IPV6_CANDIDATE_RE = /(?<![0-9a-fA-F:.])[0-9a-fA-F:.]+(?![0-9a-fA-F:.])/g;

function findIpv6(text: string): RawMatch[] {
  const out: RawMatch[] = [];
  for (const m of text.matchAll(IPV6_CANDIDATE_RE)) {
    const candidate = m[0];
    if ((candidate.match(/:/g) ?? []).length < 2) continue; // needs at least "::" or two separators
    if (isIPv6(candidate)) {
      out.push({ kind: 'ipv6', value: candidate, index: m.index });
      continue;
    }
    if (candidate.endsWith('.')) {
      const trimmed = candidate.slice(0, -1);
      if (isIPv6(trimmed)) out.push({ kind: 'ipv6', value: trimmed, index: m.index });
    }
  }
  return out;
}

// ---------------------------------------------------------------- phone (D-37, ITU-T E.164)

const DATE_SHAPE_RES = [
  /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
  /^\d{2}\.\d{2}\.\d{4}$/, // DD.MM.YYYY
  /^\d{2}\/\d{2}\/\d{4}$/, // DD/MM/YYYY
];

function looksLikeDate(candidate: string): boolean {
  return DATE_SHAPE_RES.some((re) => re.test(candidate));
}

// A maximal run of digits, "+", spaces, hyphens, dots and parentheses, bounded so it is never
// part of a longer alphanumeric run.
const PHONE_CANDIDATE_RE = /(?<![A-Za-z0-9])[+0-9()\-. ]+(?![A-Za-z0-9])/g;

function findPhones(text: string, ipv4Values: ReadonlySet<string>): RawMatch[] {
  const out: RawMatch[] = [];
  for (const m of text.matchAll(PHONE_CANDIDATE_RE)) {
    let candidate = m[0];
    let start = m.index;

    const leading = /^[ .-]+/.exec(candidate)?.[0].length ?? 0;
    candidate = candidate.slice(leading);
    start += leading;
    const trailing = /[ .-]+$/.exec(candidate)?.[0].length ?? 0;
    candidate = candidate.slice(0, candidate.length - trailing);

    if (candidate === '' || !/\d/.test(candidate)) continue;

    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) continue;
    if (looksLikeDate(candidate)) continue;
    if (isIPv4(candidate) || ipv4Values.has(candidate)) continue;

    const opens = (candidate.match(/\(/g) ?? []).length;
    const closes = (candidate.match(/\)/g) ?? []).length;
    if (opens > 1 || closes > 1 || opens !== closes) continue;

    out.push({ kind: 'phone', value: candidate, index: start });
  }
  return out;
}

// ---------------------------------------------------------------- combined extraction

/**
 * Scans `text` for every requested pattern kind, returned in text order. `dedupe` (default true)
 * collapses repeated identical (kind, value) pairs into one entry and counts them; with it off,
 * every match is its own entry with `count: 1`.
 */
export function extractPatterns(text: string, options: ExtractOptions = {}): Extracted[] {
  const kinds = options.kinds ?? PATTERN_KINDS;
  const dedupe = options.dedupe ?? true;
  const wantsKind = (k: PatternKind) => kinds.includes(k);

  // IPv4 matches are needed to exclude an IP from phone results even when 'ipv4' is not itself
  // a requested kind.
  const ipv4Matches = findIpv4(text);
  const ipv4Values = new Set(ipv4Matches.map((m) => m.value));

  const raw: RawMatch[] = [];
  if (wantsKind('email')) raw.push(...findEmails(text));
  if (wantsKind('url')) raw.push(...findUrls(text));
  if (wantsKind('ipv4')) raw.push(...ipv4Matches);
  if (wantsKind('ipv6')) raw.push(...findIpv6(text));
  if (wantsKind('phone')) raw.push(...findPhones(text, ipv4Values));

  raw.sort((a, b) => a.index - b.index || PATTERN_KINDS.indexOf(a.kind) - PATTERN_KINDS.indexOf(b.kind));

  if (!dedupe) {
    return raw.map((r) => ({ ...r, count: 1 }));
  }

  const seen = new Map<string, Extracted>();
  const ordered: Extracted[] = [];
  for (const r of raw) {
    const key = `${r.kind}\u0000${r.value}`;
    const existing = seen.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      const entry: Extracted = { ...r, count: 1 };
      seen.set(key, entry);
      ordered.push(entry);
    }
  }
  return ordered;
}
