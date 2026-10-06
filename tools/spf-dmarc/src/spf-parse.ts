import { checkRecordLength } from './limits';

/** One problem in a record: a fixed sentence (never the pasted text) and the 1-based character position it starts at. */
export interface SpfProblem {
  message: string;
  position: number;
}

export type SpfQualifier = '+' | '-' | '~' | '?';

export type SpfKind =
  'all' | 'include' | 'a' | 'mx' | 'ptr' | 'ip4' | 'ip6' | 'exists' | 'redirect' | 'exp' | 'modifier' | 'invalid';

/** One term of a record: a directive (a qualifier and a mechanism) or a modifier. */
export interface SpfTerm {
  /** The 1-based place of the term in the record. */
  index: number;
  /** The term as written. */
  text: string;
  /** The 1-based position of its first character in the joined record. */
  start: number;
  /** The 1-based position of its last character. */
  end: number;
  /** The qualifier, written or implied (a mechanism with none is +). Modifiers have none. */
  qualifier: SpfQualifier | null;
  /** Whether the qualifier was written. */
  qualifierWritten: boolean;
  kind: SpfKind;
  /** The mechanism or modifier name, lower case for the known ones and as written for an unknown modifier. */
  name: string;
  /** What follows the colon or the equals sign, as written. */
  argument: string;
  problems: SpfProblem[];
}

export interface SpfRecord {
  /** The record as given. */
  text: string;
  /** Its length in characters. */
  length: number;
  /** Its length in octets (UTF-8), which is what the size limits of RFC 7208 section 3.4 count. */
  octets: number;
  /** Whether it starts with v=spf1 followed by a space or the end (RFC 7208 section 4.5). */
  isSpf: boolean;
  terms: SpfTerm[];
  /** Every problem of the record and of its terms, in the order found. */
  errors: SpfProblem[];
}

const MECHANISMS: ReadonlySet<string> = new Set(['all', 'include', 'a', 'mx', 'ptr', 'ip4', 'ip6', 'exists']);

const SPACE = 32;

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** name = ALPHA *( ALPHA / DIGIT / "-" / "_" / "." ) (RFC 7208 section 12). */
function isModifierName(name: string): boolean {
  if (name.length === 0 || !isLetter(name.charCodeAt(0))) return false;
  for (let i = 1; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (!isLetter(c) && !isDigit(c) && c !== 45 && c !== 95 && c !== 46) return false;
  }
  return true;
}

function parseTerm(text: string, from: number, to: number, index: number, seen: Map<string, number>): SpfTerm {
  const start = from + 1;
  const term: SpfTerm = {
    index,
    text: text.slice(from, to),
    start,
    end: to,
    qualifier: null,
    qualifierWritten: false,
    kind: 'invalid',
    name: '',
    argument: '',
    problems: [],
  };
  let p = from;
  const first = text.charAt(p);
  if (first === '+' || first === '-' || first === '~' || first === '?') {
    term.qualifier = first;
    term.qualifierWritten = true;
    p++;
  }
  // The name ends at the first colon, equals sign or slash (RFC 7208 section 4.6.1).
  let q = p;
  while (q < to) {
    const c = text.charAt(q);
    if (c === ':' || c === '=' || c === '/') break;
    q++;
  }
  const token = text.slice(p, q);
  const delimiter = q < to ? text.charAt(q) : '';

  if (delimiter === '=') {
    // A modifier: name "=" value.
    term.qualifier = null;
    term.argument = text.slice(q + 1, to);
    const lower = token.toLowerCase();
    if (term.qualifierWritten) {
      term.problems.push({ message: 'A modifier cannot have a qualifier in front of it.', position: start });
    }
    if (!isModifierName(token)) {
      term.problems.push({
        message:
          'A modifier name starts with a letter and holds only letters, digits, hyphens, underscores and periods.',
        position: p + 1,
      });
      return term;
    }
    if (lower === 'redirect' || lower === 'exp') {
      term.kind = lower;
      term.name = lower;
      const earlier = seen.get(lower);
      if (earlier !== undefined) {
        term.problems.push({
          message: `${lower} must not appear more than once in a record (RFC 7208 section 6); the first is at position ${earlier}.`,
          position: p + 1,
        });
      } else {
        seen.set(lower, p + 1);
      }
    } else {
      term.kind = 'modifier';
      term.name = token;
    }
    return term;
  }

  const lower = token.toLowerCase();
  if (!MECHANISMS.has(lower)) {
    term.problems.push({
      message:
        token.length === 0
          ? 'A term needs a mechanism name or a modifier name here.'
          : 'This is not an SPF mechanism, and a modifier needs an equals sign after its name.',
      position: p + 1,
    });
    return term;
  }
  term.kind = lower as SpfKind;
  term.name = lower;
  if (term.qualifier === null) term.qualifier = '+';
  if (delimiter === ':') term.argument = text.slice(q + 1, to);
  else if (delimiter === '/') term.argument = text.slice(q, to);

  if (lower === 'all' && delimiter !== '') {
    term.problems.push({ message: 'The all mechanism takes nothing after its name.', position: q + 1 });
  } else if ((lower === 'include' || lower === 'exists' || lower === 'ip4' || lower === 'ip6') && delimiter !== ':') {
    term.problems.push({
      message: `The ${lower} mechanism needs a colon and a value after its name.`,
      position: q + 1,
    });
  } else if (delimiter === ':' && term.argument === '') {
    term.problems.push({ message: `The ${lower} mechanism has nothing after its colon.`, position: q + 2 });
  }
  return term;
}

/**
 * Reads one SPF record in a single pass. Terms are separated by spaces only (RFC 7208 section 12); every term keeps its
 * position, and every problem is a fixed sentence with a position, never the pasted text.
 */
export function parseSpf(text: string): SpfRecord {
  checkRecordLength(text, 'spf');
  const record: SpfRecord = {
    text,
    length: text.length,
    octets: new TextEncoder().encode(text).length,
    isSpf: false,
    terms: [],
    errors: [],
  };
  const versionEnds = text.length === 6 || (text.length > 6 && text.charCodeAt(6) === SPACE);
  if (text.slice(0, 6).toLowerCase() !== 'v=spf1' || !versionEnds) {
    record.errors.push({
      message:
        text.slice(0, 6).toLowerCase() === 'v=spf1'
          ? 'The version v=spf1 must be followed by a space or the end of the record, so this is not an SPF record (RFC 7208 section 4.5).'
          : 'An SPF record starts with v=spf1 (RFC 7208 section 4.5).',
      position: 1,
    });
    return record;
  }
  record.isSpf = true;
  const seen = new Map<string, number>();
  const n = text.length;
  let i = 6;
  while (i < n) {
    if (text.charCodeAt(i) === SPACE) {
      i++;
      continue;
    }
    const from = i;
    while (i < n && text.charCodeAt(i) !== SPACE) i++;
    const term = parseTerm(text, from, i, record.terms.length + 1, seen);
    record.terms.push(term);
    for (const problem of term.problems) record.errors.push(problem);
  }
  return record;
}
