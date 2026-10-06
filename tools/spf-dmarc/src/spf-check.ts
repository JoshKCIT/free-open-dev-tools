import { LOOKUP_LIMIT, SIZE_NOTE_OCTETS, STRING_OCTETS } from './limits';
import type { SpfKind, SpfQualifier, SpfRecord, SpfTerm } from './spf-parse';
import { visible } from './visible';

/** The kinds of term that cause a DNS lookup (RFC 7208 section 4.6.4). */
export type LookupKind = 'include' | 'a' | 'mx' | 'ptr' | 'exists' | 'redirect';

const LOOKUP_KINDS: ReadonlySet<SpfKind> = new Set<SpfKind>(['include', 'a', 'mx', 'ptr', 'exists', 'redirect']);
const MECHANISM_KINDS: ReadonlySet<SpfKind> = new Set<SpfKind>([
  'all',
  'include',
  'a',
  'mx',
  'ptr',
  'ip4',
  'ip6',
  'exists',
]);

export interface LookupTerm {
  /** The term as written. */
  term: string;
  kind: LookupKind;
  /** The 1-based place of the term in the record. */
  termIndex: number;
  start: number;
  end: number;
}

export type NoteTone = 'info' | 'warn';

export interface SpfNote {
  tone: NoteTone;
  message: string;
  /** The 1-based character position the note is about, when there is one. */
  position?: number;
}

export interface SpfReport {
  record: SpfRecord;
  /** True when the record is an SPF record with no syntax error. */
  valid: boolean;
  /** The limit of terms that cause lookups. */
  limit: number;
  /** The terms that cause lookups, in record order. */
  lookups: LookupTerm[];
  lookupCount: number;
  withinLimit: boolean;
  /** Why a receiver would give permerror, or null. */
  permerror: string | null;
  /** The 1-based places of the mechanisms that come after the first all and are never tested (RFC 7208 section 5.1). */
  neverTested: number[];
  /** True when a redirect is present and ignored because the record also holds an all (RFC 7208 section 6.1). */
  redirectIgnored: boolean;
  /** The record's length in octets. */
  octets: number;
  /** How many character-strings of at most 255 octets the record needs. */
  stringsNeeded: number;
  /** The most octets any one given string holds, or null when the strings were not given. */
  longestString: number | null;
  notes: SpfNote[];
}

function isLookup(term: SpfTerm): term is SpfTerm & { kind: LookupKind } {
  return LOOKUP_KINDS.has(term.kind);
}

const RESULT_OF: Record<SpfQualifier, string> = {
  '+': 'pass',
  '-': 'fail',
  '~': 'softfail',
  '?': 'neutral',
};

/** What a term means, in one sentence that holds at most 40 characters of the pasted argument. */
export function describeTerm(term: SpfTerm): string {
  if (term.kind === 'invalid') return 'Not a term this page can read.';
  const shown = visible(term.argument, 40);
  const result = term.qualifier === null ? '' : RESULT_OF[term.qualifier];
  const onMatch = result === '' ? '' : ` A match gives ${result}.`;
  switch (term.kind) {
    case 'all':
      return `Matches every sender.${onMatch}`;
    case 'include':
      return `Checks the record of the domain named after the colon (${shown}); a pass there is a match.${onMatch}`;
    case 'a':
      return `Matches when the sender address is one of the addresses of ${term.domain === null ? 'the domain being checked' : 'the named domain'}${prefixText(term)}.${onMatch}`;
    case 'mx':
      return `Matches when the sender address is one of the addresses of the mail servers of ${term.domain === null ? 'the domain being checked' : 'the named domain'}${prefixText(term)}.${onMatch}`;
    case 'ptr':
      return `Matches by the reverse name of the sender address. RFC 7208 section 5.5 says not to publish it.${onMatch}`;
    case 'ip4':
      return `Matches a sender address in the IPv4 network ${visible(term.network ?? '', 40)}${term.cidr4 === null ? '' : ` with a prefix length of ${term.cidr4}`}.${onMatch}`;
    case 'ip6':
      return `Matches a sender address in the IPv6 network ${visible(term.network ?? '', 40)}${term.cidr6 === null ? '' : ` with a prefix length of ${term.cidr6}`}.${onMatch}`;
    case 'exists':
      return `Matches when the name built from ${shown} has an address record.${onMatch}`;
    case 'redirect':
      return `Continues with the record of the domain named after the equals sign (${shown}) when no mechanism matched.`;
    case 'exp':
      return `Names the domain whose text explains a fail result (${shown}).`;
    default:
      return 'A modifier this page does not know, which is ignored.';
  }
}

/** The prefix length part of a sentence for a and mx, or nothing. */
function prefixText(term: SpfTerm): string {
  const parts: string[] = [];
  if (term.cidr4 !== null) parts.push(`IPv4 addresses are compared on their first ${term.cidr4} bits`);
  if (term.cidr6 !== null) parts.push(`IPv6 addresses on their first ${term.cidr6} bits`);
  return parts.length === 0 ? '' : ` (${parts.join(' and ')})`;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Counts the terms of a parsed record that cause DNS lookups (RFC 7208 section 4.6.4) and says what else is worth knowing.
 * No lookup is made: the count is of the terms as written. Terms with a syntax error are not counted, because a record
 * with a syntax error ends in permerror before any lookup (section 4.6). `strings` are the quoted strings the record was
 * read from, when it came from a zone-file line; they are only used to check the 255 octet limit of one string.
 */
export function checkSpf(record: SpfRecord, strings?: readonly string[]): SpfReport {
  const notes: SpfNote[] = [];
  const valid = record.isSpf && record.errors.length === 0;
  const lookups: LookupTerm[] = [];
  const neverTested: number[] = [];

  // The first all that is read without a problem ends the testing of mechanisms (RFC 7208 section 5.1).
  let firstAll: SpfTerm | null = null;
  for (const term of record.terms) {
    if (term.kind === 'all' && term.problems.length === 0) {
      firstAll = term;
      break;
    }
  }
  const hasAll = firstAll !== null;
  let redirect: SpfTerm | null = null;
  let ptr: SpfTerm | null = null;
  let mx: SpfTerm | null = null;
  let usesPtrMacro: SpfTerm | null = null;
  for (const term of record.terms) {
    if (term.problems.length > 0) continue;
    if (term.kind === 'redirect' && redirect === null) redirect = term;
    if (term.kind === 'ptr' && ptr === null) ptr = term;
    if (term.kind === 'mx' && mx === null) mx = term;
    if (term.usesPtrMacro && usesPtrMacro === null) usesPtrMacro = term;
  }
  const redirectIgnored = hasAll && redirect !== null;

  for (const term of record.terms) {
    const afterAll = firstAll !== null && term.index > firstAll.index && MECHANISM_KINDS.has(term.kind);
    if (afterAll) {
      neverTested.push(term.index);
      continue;
    }
    if (term.problems.length > 0 || !isLookup(term)) continue;
    // A redirect is ignored when the record also holds an all (RFC 7208 section 6.1), so it is not counted.
    if (term.kind === 'redirect' && hasAll) continue;
    lookups.push({ term: term.text, kind: term.kind, termIndex: term.index, start: term.start, end: term.end });
  }
  const lookupCount = lookups.length;
  const withinLimit = lookupCount <= LOOKUP_LIMIT;

  if (firstAll !== null) {
    const position = firstAll.start;
    if (firstAll.qualifier === '+') {
      notes.push({
        tone: 'warn',
        message: `${firstAll.qualifierWritten ? '+all' : 'all with no qualifier'} matches every sender and gives pass, so the record allows any server to send as this domain.`,
        position,
      });
    } else if (firstAll.qualifier === '?') {
      notes.push({
        tone: 'info',
        message: '?all gives neutral to every sender that matched no earlier term: it states no policy.',
        position,
      });
    } else if (firstAll.qualifier === '~') {
      notes.push({
        tone: 'info',
        message:
          '~all gives softfail to every sender that matched no earlier term: a receiver is asked to treat the message as suspect, not to reject it.',
        position,
      });
    }
  }
  if (ptr !== null) {
    notes.push({
      tone: 'warn',
      message:
        'The ptr mechanism should not be published (RFC 7208 section 5.5): it is slow, unreliable and loads other servers.',
      position: ptr.start,
    });
  }
  if (usesPtrMacro !== null) {
    notes.push({
      tone: 'info',
      message:
        'A macro with the p letter looks up the reverse name of the sender address, and RFC 7208 section 7.2 says not to use it. It also counts toward the limit.',
      position: usesPtrMacro.start,
    });
  }
  if (mx !== null) {
    notes.push({
      tone: 'info',
      message: `An mx term counts once here, but each mail server it finds is looked up for addresses too, up to ${LOOKUP_LIMIT} of them, and more than that makes the term permerror (RFC 7208 section 4.6.4). This page cannot see them.`,
      position: mx.start,
    });
  }
  if (lookupCount > 0) {
    notes.push({
      tone: 'info',
      message:
        'A term that looks up a name which does not exist, or finds no answer, is a void lookup; RFC 7208 section 4.6.4 says to limit them to two. This page cannot see which names exist.',
    });
  }
  if (record.isSpf && !hasAll && redirect === null) {
    notes.push({
      tone: 'info',
      message:
        'With no all and no redirect, a message that matches no term gets the result neutral, as if the record ended in ?all (RFC 7208 section 4.7).',
    });
  }
  if (redirectIgnored && redirect !== null) {
    notes.push({
      tone: 'info',
      message:
        'The redirect is ignored and not counted because the record also holds an all, whatever their order (RFC 7208 section 6.1).',
      position: redirect.start,
    });
  }
  if (neverTested.length > 0 && firstAll !== null) {
    notes.push({
      tone: 'warn',
      message: `${neverTested.length} ${neverTested.length === 1 ? 'term comes' : 'terms come'} after the all and ${neverTested.length === 1 ? 'is' : 'are'} never tested (RFC 7208 section 5.1).`,
      position: record.terms[(neverTested[0] ?? 1) - 1]?.start ?? firstAll.end + 2,
    });
  }
  // The same term written twice (compared as written, ignoring letter case), reported without repeating its text.
  const firstSeen = new Map<string, SpfTerm>();
  for (const term of record.terms) {
    if (term.problems.length > 0) continue;
    const key = term.text.toLowerCase();
    const earlier = firstSeen.get(key);
    if (earlier === undefined) {
      firstSeen.set(key, term);
    } else {
      notes.push({
        tone: 'info',
        message: `The term at position ${term.start} repeats the one at position ${earlier.start}.`,
        position: term.start,
      });
    }
  }
  if (record.octets > SIZE_NOTE_OCTETS) {
    notes.push({
      tone: 'warn',
      message: `The record is ${record.octets} octets. Keep it under ${SIZE_NOTE_OCTETS} octets so the whole answer fits a 512 octet DNS message (RFC 7208 section 3.4).`,
    });
  }
  let longestString: number | null = null;
  if (strings !== undefined && strings.length > 0) {
    longestString = 0;
    for (const s of strings) longestString = Math.max(longestString, utf8Length(s));
    if (longestString > STRING_OCTETS) {
      notes.push({
        tone: 'warn',
        message: `One string of the TXT record is ${longestString} octets, and a string holds at most ${STRING_OCTETS} octets (RFC 7208 section 3.3). Split the record into several strings.`,
      });
    }
  }
  if (!withinLimit) {
    notes.push({
      tone: 'warn',
      message: `${lookupCount} terms cause DNS lookups, over the limit of ${LOOKUP_LIMIT}: a receiver that counts more than ${LOOKUP_LIMIT} returns permerror (RFC 7208 section 4.6.4).`,
    });
  }

  let permerror: string | null = null;
  if (!record.isSpf) permerror = 'This is not an SPF record, so a receiver would not use it (RFC 7208 section 4.5).';
  else if (record.errors.length > 0) {
    permerror = `A syntax error at position ${record.errors[0]?.position ?? 1} makes a receiver stop with permerror before any lookup (RFC 7208 section 4.6).`;
  } else if (!withinLimit) {
    permerror = `More than ${LOOKUP_LIMIT} terms cause DNS lookups (RFC 7208 section 4.6.4).`;
  }

  return {
    record,
    valid,
    limit: LOOKUP_LIMIT,
    lookups,
    lookupCount,
    withinLimit,
    permerror,
    neverTested,
    redirectIgnored,
    octets: record.octets,
    stringsNeeded: record.octets === 0 ? 0 : Math.ceil(record.octets / STRING_OCTETS),
    longestString,
    notes,
  };
}
