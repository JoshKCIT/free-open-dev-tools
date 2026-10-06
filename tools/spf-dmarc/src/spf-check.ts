import { LOOKUP_LIMIT } from './limits';
import type { SpfKind, SpfRecord, SpfTerm } from './spf-parse';

/** The kinds of term that cause a DNS lookup (RFC 7208 section 4.6.4). */
export type LookupKind = 'include' | 'a' | 'mx' | 'ptr' | 'exists' | 'redirect';

const LOOKUP_KINDS: ReadonlySet<SpfKind> = new Set<SpfKind>(['include', 'a', 'mx', 'ptr', 'exists', 'redirect']);

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
  notes: SpfNote[];
}

function isLookup(term: SpfTerm): term is SpfTerm & { kind: LookupKind } {
  return LOOKUP_KINDS.has(term.kind);
}

/**
 * Counts the terms of a parsed record that cause DNS lookups (RFC 7208 section 4.6.4) and says what else is worth knowing.
 * No lookup is made: the count is of the terms as written. Terms with a syntax error are not counted, because a record
 * with a syntax error ends in permerror before any lookup (section 4.6).
 */
export function checkSpf(record: SpfRecord): SpfReport {
  const notes: SpfNote[] = [];
  const valid = record.isSpf && record.errors.length === 0;
  const lookups: LookupTerm[] = [];
  let hasAll = false;
  let hasRedirect = false;
  for (const term of record.terms) {
    if (term.problems.length > 0) continue;
    if (term.kind === 'all') hasAll = true;
    if (term.kind === 'redirect') hasRedirect = true;
  }
  let reachedAll = false;
  for (const term of record.terms) {
    if (term.problems.length > 0) continue;
    if (reachedAll && term.kind !== 'redirect' && term.kind !== 'exp' && term.kind !== 'modifier') continue;
    if (term.kind === 'all') reachedAll = true;
    if (!isLookup(term)) continue;
    // A redirect is ignored when the record also holds an all (RFC 7208 section 6.1), so it is not counted.
    if (term.kind === 'redirect' && hasAll) continue;
    lookups.push({ term: term.text, kind: term.kind, termIndex: term.index, start: term.start, end: term.end });
  }
  const lookupCount = lookups.length;
  if (record.isSpf && !hasAll && !hasRedirect) {
    notes.push({
      tone: 'info',
      message:
        'With no all and no redirect, a message that matches no term gets the result neutral, as if the record ended in ?all (RFC 7208 section 4.7).',
    });
  }
  if (lookupCount > LOOKUP_LIMIT) {
    notes.push({
      tone: 'warn',
      message: `${lookupCount} terms cause DNS lookups. The limit is ${LOOKUP_LIMIT}, and a receiver that counts more than ${LOOKUP_LIMIT} returns permerror (RFC 7208 section 4.6.4).`,
    });
  }
  return { record, valid, limit: LOOKUP_LIMIT, lookups, lookupCount, withinLimit: lookupCount <= LOOKUP_LIMIT, notes };
}
