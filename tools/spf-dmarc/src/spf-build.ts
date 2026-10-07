import { SpfDmarcError } from './errors';
import { MAX_RECORD_CHARACTERS, MAX_RECORDS, STRING_OCTETS, checkPaste, withCommas } from './limits';
import { checkSpf, type SpfReport } from './spf-check';
import { parseSpf } from './spf-parse';

/** How the built record ends. */
export type SpfEnding = '-all' | '~all' | '?all' | 'redirect';

/** What the SPF builder is given. The three list fields hold one entry per line. */
export interface SpfFields {
  /** IPv4 addresses or networks, such as 192.0.2.10 or 198.51.100.0/24. */
  ip4: string;
  /** IPv6 addresses or networks, such as 2001:db8::/32. */
  ip6: string;
  /** Domains whose records are included. */
  includes: string;
  /** Allow the addresses of the domain's own address records (the a mechanism). */
  a: boolean;
  /** Allow the addresses of the domain's mail servers (the mx mechanism). */
  mx: boolean;
  ending: SpfEnding;
  /** The domain a redirect points at, used only when the ending is redirect. */
  redirect: string;
}

export type BuildField = 'ip4' | 'ip6' | 'includes' | 'redirect';

/** An entry that was left out of the record, with the field and the 1-based line it was on. Never holds the entry. */
export interface BuildProblem {
  field: BuildField;
  line: number;
  message: string;
}

export interface BuiltSpf {
  /** The record, with its terms in the fixed order: v=spf1, ip4, ip6, a, mx, include, then the ending. */
  record: string;
  length: number;
  octets: number;
  /** The number of terms of the record that cause DNS lookups. */
  lookups: number;
  problems: BuildProblem[];
  /**
   * Entries that were kept after the prefix the builder writes itself (ip4:, ip6:, include: or redirect=) was dropped from
   * their start, with the field and the line. Never holds the entry.
   */
  adjusted: BuildProblem[];
  /** The record read back by the same parser and checker the page uses to check a pasted record. */
  report: SpfReport;
}

const LABELS: Record<BuildField, string> = {
  ip4: 'ip4',
  ip6: 'ip6',
  includes: 'include',
  redirect: 'redirect',
};

function isBlank(code: number): boolean {
  return code === 32 || code === 9;
}

/** The lines of a list field with their 1-based numbers; blank lines are skipped, and surrounding blanks are trimmed. */
function entriesOf(text: string, field: BuildField): Array<{ line: number; entry: string }> {
  const out: Array<{ line: number; entry: string }> = [];
  if (text === '') return out;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i] ?? '';
    if (raw.endsWith('\r')) raw = raw.slice(0, -1);
    let from = 0;
    let to = raw.length;
    while (from < to && isBlank(raw.charCodeAt(from))) from++;
    while (to > from && isBlank(raw.charCodeAt(to - 1))) to--;
    if (from === to) continue;
    if (out.length >= MAX_RECORDS) {
      throw new SpfDmarcError(
        `The ${LABELS[field]} list holds more than ${MAX_RECORDS} entries. The limit is ${MAX_RECORDS}, so the entry on line ${withCommas(i + 1)} and the rest were not read.`,
        'builder',
        i + 1,
      );
    }
    out.push({ line: i + 1, entry: raw.slice(from, to) });
  }
  return out;
}

/** The prefix the builder writes before an entry of each field. */
const PREFIXES: Record<BuildField, string> = {
  ip4: 'ip4:',
  ip6: 'ip6:',
  includes: 'include:',
  redirect: 'redirect=',
};

/** True when `entry` holds `prefix` at `at`, in any ASCII letter case, with something after it. */
function prefixAt(entry: string, at: number, prefix: string): boolean {
  if (entry.length - at <= prefix.length) return false;
  for (let k = 0; k < prefix.length; k++) {
    let c = entry.charCodeAt(at + k);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== prefix.charCodeAt(k)) return false;
  }
  return true;
}

/**
 * The entry without the prefix the builder writes itself, when it was typed with it (as provider documentation writes
 * include:<name>). RFC 7208 allows a colon and an equals sign inside a domain-spec, so include:include:<name> would read
 * as one valid include of a name that does not exist. The prefix is dropped as often as it repeats, in one pass.
 */
function dropOwnPrefix(entry: string, prefix: string): { entry: string; dropped: boolean } {
  let at = 0;
  while (prefixAt(entry, at, prefix)) at += prefix.length;
  return at === 0 ? { entry, dropped: false } : { entry: entry.slice(at), dropped: true };
}

/** The line that says a prefix was dropped. Fixed text: it never holds the entry. */
function droppedMessage(field: BuildField): string {
  return `The entry started with ${PREFIXES[field]}, which the builder writes itself, so that prefix was dropped.`;
}

/** The term for one entry when it reads as exactly one term of the wanted kind with no problem, else the first problem. */
function termFor(prefix: string, kind: string, entry: string): { term: string } | { message: string } {
  for (let i = 0; i < entry.length; i++) {
    const c = entry.charCodeAt(i);
    if (c <= 32 || c === 127)
      return { message: 'An entry cannot hold a space or any other blank or control character.' };
  }
  const term = prefix + entry;
  const record = parseSpf('v=spf1 ' + term);
  const only = record.terms[0];
  if (record.terms.length !== 1 || only === undefined) return { message: 'This entry does not read as one term.' };
  if (only.problems.length > 0) return { message: only.problems[0]?.message ?? 'This entry is not valid.' };
  if (only.kind !== kind) return { message: 'This entry does not read as the kind of term the field is for.' };
  return { term };
}

/**
 * Builds an SPF record from fields. Every entry is checked by the same parser a pasted record goes through; one that does
 * not read as a single valid term is left out and listed as a problem (with its line, never its text). The terms are
 * always written in the same order whatever order the lines were typed in: v=spf1, ip4, ip6, a, mx, include, the ending.
 * An entry typed with the prefix the builder writes itself (include:<name>, for example) is kept without it and listed in
 * `adjusted`. The finished record is parsed and checked again before it is returned.
 */
export function buildSpf(fields: SpfFields): BuiltSpf {
  checkPaste(fields.ip4, 'builder');
  checkPaste(fields.ip6, 'builder');
  checkPaste(fields.includes, 'builder');
  checkPaste(fields.redirect, 'builder');
  const problems: BuildProblem[] = [];
  const adjusted: BuildProblem[] = [];
  const terms: string[] = ['v=spf1'];
  const one = (field: BuildField, kind: string, line: number, typed: string): void => {
    const own = dropOwnPrefix(typed, PREFIXES[field]);
    const result = termFor(PREFIXES[field], kind, own.entry);
    if ('term' in result) {
      terms.push(result.term);
      if (own.dropped) adjusted.push({ field, line, message: droppedMessage(field) });
    } else problems.push({ field, line, message: result.message });
  };
  const add = (field: BuildField, kind: string, text: string): void => {
    for (const { line, entry } of entriesOf(text, field)) one(field, kind, line, entry);
  };
  add('ip4', 'ip4', fields.ip4);
  add('ip6', 'ip6', fields.ip6);
  if (fields.a) terms.push('a');
  if (fields.mx) terms.push('mx');
  add('includes', 'include', fields.includes);
  if (fields.ending === 'redirect') {
    const target = entriesOf(fields.redirect, 'redirect');
    if (target.length === 0) {
      problems.push({ field: 'redirect', line: 1, message: 'Enter the domain the redirect points at.' });
    } else {
      const first = target[0];
      if (first !== undefined) {
        one('redirect', 'redirect', first.line, first.entry);
        if (target.length > 1) {
          problems.push({
            field: 'redirect',
            line: target[1]?.line ?? 2,
            message: 'A record has one redirect, so only the first line is used.',
          });
        }
      }
    }
  } else {
    terms.push(fields.ending);
  }
  const record = terms.join(' ');
  if (record.length > MAX_RECORD_CHARACTERS) {
    throw new SpfDmarcError(
      `The record built from these fields would hold ${withCommas(record.length)} characters. The limit is ${withCommas(MAX_RECORD_CHARACTERS)}, so remove some entries.`,
      'builder',
    );
  }
  const report = checkSpf(parseSpf(record));
  return {
    record,
    length: record.length,
    octets: report.octets,
    lookups: report.lookupCount,
    problems,
    adjusted,
    report,
  };
}

/**
 * The record as the value of a TXT record in a zone file: quoted, and split into strings of at most 255 octets when it is
 * longer, which is how RFC 7208 section 3.3 says a long record is published (the strings are joined with no space added).
 * A quote or a backslash in the text is escaped.
 */
export function toTxtValue(text: string): string {
  const encoder = new TextEncoder();
  const strings: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of text) {
    const escaped = ch === '"' || ch === '\\' ? '\\' + ch : ch;
    const size = encoder.encode(escaped).length;
    if (octets + size > STRING_OCTETS) {
      strings.push(current);
      current = '';
      octets = 0;
    }
    current += escaped;
    octets += size;
  }
  strings.push(current);
  return strings.map((s) => `"${s}"`).join(' ');
}
