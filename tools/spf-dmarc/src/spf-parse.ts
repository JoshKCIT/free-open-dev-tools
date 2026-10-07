import { isIp4Literal, isIp6Literal } from './addresses';
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
  /** What follows the colon or the equals sign (or starts at the slash), as written. */
  argument: string;
  /** The domain specification as written, when the term has one. */
  domain: string | null;
  /** The address of an ip4 or ip6 term as written. */
  network: string | null;
  /** The IPv4 prefix length, when written. */
  cidr4: number | null;
  /** The IPv6 prefix length, when written. */
  cidr6: number | null;
  /** Whether a macro of the term uses the p letter, which looks up the reverse name of the address. */
  usesPtrMacro: boolean;
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
const PERCENT = 37;
const SLASH = 47;
const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;

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

/** The macro letters of RFC 7208 section 7.2 that are allowed in a term; c, r and t are for explanation text only. */
const TERM_LETTERS = 'slodiphv';
const EXP_ONLY_LETTERS = 'crt';
/** delimiter = "." / "-" / "+" / "," / "/" / "_" / "=" (RFC 7208 section 12). */
const DELIMITERS = '.-+,/_=';

interface MacroScan {
  problem: SpfProblem | null;
  /** Whether the text ends with a macro-expand (so it needs no period and top label after it). */
  endsWithMacro: boolean;
  /** Whether a macro uses the p letter. */
  usesPtr: boolean;
}

/**
 * Reads a macro-string (RFC 7208 section 12) in one pass: visible characters, and the macro forms %{...}, %%, %_ and %-.
 * Stops at the first problem. `base` is the 1-based position of the first character of `spec` in the record.
 */
function scanMacroString(spec: string, base: number): MacroScan {
  const n = spec.length;
  const scan: MacroScan = { problem: null, endsWithMacro: false, usesPtr: false };
  let i = 0;
  while (i < n) {
    const c = spec.charCodeAt(i);
    if (c === PERCENT) {
      const next = spec.charAt(i + 1);
      if (next === '%' || next === '_' || next === '-') {
        i += 2;
        scan.endsWithMacro = i === n;
        continue;
      }
      if (spec.charCodeAt(i + 1) !== OPEN_BRACE) {
        scan.problem = {
          message: 'A percent sign must start a macro: %{, %%, %_ or %- (RFC 7208 section 7.3).',
          position: base + i,
        };
        return scan;
      }
      let j = i + 2;
      const letter = spec.charAt(j).toLowerCase();
      if (letter === '' || (!TERM_LETTERS.includes(letter) && !EXP_ONLY_LETTERS.includes(letter))) {
        scan.problem = { message: 'This is not a macro letter (RFC 7208 section 7.2).', position: base + j };
        return scan;
      }
      if (EXP_ONLY_LETTERS.includes(letter)) {
        scan.problem = {
          message: 'The macro letters c, r and t are allowed only in explanation text (RFC 7208 section 7.2).',
          position: base + j,
        };
        return scan;
      }
      if (letter === 'p') scan.usesPtr = true;
      j++;
      const digits = j;
      while (j < n && isDigit(spec.charCodeAt(j))) j++;
      if (j > digits) {
        let allZero = true;
        for (let k = digits; k < j; k++) if (spec.charCodeAt(k) !== 48) allZero = false;
        if (allZero) {
          scan.problem = { message: 'A macro digit must not be zero (RFC 7208 section 7.3).', position: base + digits };
          return scan;
        }
      }
      if (spec.charAt(j) === 'r' || spec.charAt(j) === 'R') j++;
      while (j < n && DELIMITERS.includes(spec.charAt(j))) j++;
      if (spec.charCodeAt(j) !== CLOSE_BRACE) {
        scan.problem = {
          message: 'The macro is not closed, or holds a character a macro cannot hold (RFC 7208 section 12).',
          position: base + j,
        };
        return scan;
      }
      i = j + 1;
      scan.endsWithMacro = i === n;
      continue;
    }
    // macro-literal = %x21-24 / %x26-7E: every visible character except the percent sign.
    if (c < 0x21 || c > 0x7e) {
      scan.problem = {
        message:
          'A space, a control character or a character outside US-ASCII is not allowed here (RFC 7208 section 12).',
        position: base + i,
      };
      return scan;
    }
    scan.endsWithMacro = false;
    i++;
  }
  return scan;
}

/** toplabel (RFC 7208 section 12): letters, digits and hyphens, not starting or ending with a hyphen, not all digits. */
function isToplabel(label: string): boolean {
  const n = label.length;
  if (n === 0) return false;
  let letterOrHyphen = false;
  for (let i = 0; i < n; i++) {
    const c = label.charCodeAt(i);
    if (isLetter(c)) letterOrHyphen = true;
    else if (c === 45) {
      if (i === 0 || i === n - 1) return false;
      letterOrHyphen = true;
    } else if (!isDigit(c)) return false;
  }
  return letterOrHyphen;
}

interface DomainScan {
  problem: SpfProblem | null;
  usesPtr: boolean;
}

/** A domain-spec (RFC 7208 section 12): a macro-string that ends in a macro, or in a period and a top label. */
function scanDomainSpec(spec: string, base: number): DomainScan {
  const scan = scanMacroString(spec, base);
  if (scan.problem !== null) return { problem: scan.problem, usesPtr: scan.usesPtr };
  if (scan.endsWithMacro) return { problem: null, usesPtr: scan.usesPtr };
  const end = spec.endsWith('.') ? spec.length - 1 : spec.length;
  const dot = end === 0 ? -1 : spec.lastIndexOf('.', end - 1);
  if (dot < 0) {
    return {
      problem: {
        message: 'A domain name here needs a period and a top label at its end (RFC 7208 section 12, domain-end).',
        position: base,
      },
      usesPtr: scan.usesPtr,
    };
  }
  if (!isToplabel(spec.slice(dot + 1, end))) {
    return {
      problem: {
        message:
          'The last part of the name is not a top label: it needs a letter or a hyphen, and it cannot start or end with a hyphen (RFC 7208 section 12, toplabel).',
        position: base + dot + 1,
      },
      usesPtr: scan.usesPtr,
    };
  }
  return { problem: null, usesPtr: scan.usesPtr };
}

interface Length {
  value: number | null;
  next: number;
  failed: boolean;
}

/** Reads one prefix length from `text` at `from`. `start` is the 0-based index of text[0] in the record. */
function readLength(text: string, from: number, max: number, start: number, problems: SpfProblem[]): Length {
  let j = from;
  while (j < text.length && isDigit(text.charCodeAt(j))) j++;
  const position = start + from + 1;
  if (j === from) {
    problems.push({ message: 'A prefix length needs a number after its slash (RFC 7208 section 12).', position });
    return { value: null, next: from, failed: true };
  }
  if (j - from > 1 && text.charCodeAt(from) === 48) {
    problems.push({ message: 'A prefix length has no leading zeros (RFC 7208 section 12).', position });
    return { value: null, next: j, failed: true };
  }
  const value = j - from > 4 ? Number.POSITIVE_INFINITY : Number(text.slice(from, j));
  if (value > max) {
    problems.push({ message: `This prefix length is out of range: it goes from 0 to ${max}.`, position });
    return { value: null, next: j, failed: true };
  }
  return { value, next: j, failed: false };
}

/** The dual prefix length of a and mx: [ "/" ip4-len ] [ "//" ip6-len ]. `text` starts with a slash. */
function readDualCidr(
  text: string,
  start: number,
  problems: SpfProblem[],
): { cidr4: number | null; cidr6: number | null } {
  let cidr4: number | null = null;
  let cidr6: number | null = null;
  let i = 0;
  if (text.charAt(1) !== '/') {
    const r = readLength(text, 1, 32, start, problems);
    if (r.failed) return { cidr4, cidr6 };
    cidr4 = r.value;
    i = r.next;
  }
  if (i < text.length) {
    if (text.charAt(i) === '/' && text.charAt(i + 1) === '/') {
      const r = readLength(text, i + 2, 128, start, problems);
      if (!r.failed) cidr6 = r.value;
    } else {
      problems.push({
        message: 'Two slashes must come before an IPv6 prefix length (RFC 7208 section 12).',
        position: start + i + 1,
      });
    }
  }
  return { cidr4, cidr6 };
}

/** The single prefix length of ip4 and ip6. `text` starts with a slash. */
function readSingleCidr(text: string, max: number, start: number, problems: SpfProblem[]): number | null {
  const r = readLength(text, 1, max, start, problems);
  if (r.failed) return null;
  if (r.next < text.length) {
    problems.push({
      message: 'Nothing may follow the prefix length (RFC 7208 section 12).',
      position: start + r.next + 1,
    });
    return null;
  }
  return r.value;
}

/**
 * Where the prefix length of an a or mx argument starts, or -1: the first slash outside a macro whose rest holds only
 * digits and slashes. The trailing run of digits and slashes is found once, from the end, so the argument is read twice
 * at most, never once per slash.
 */
function cidrStart(argument: string): number {
  let tail = argument.length;
  while (tail > 0) {
    const c = argument.charCodeAt(tail - 1);
    if (c !== SLASH && !isDigit(c)) break;
    tail--;
  }
  let depth = 0;
  for (let i = 0; i < argument.length; i++) {
    const c = argument.charCodeAt(i);
    if (c === OPEN_BRACE && i > 0 && argument.charCodeAt(i - 1) === PERCENT) depth++;
    else if (c === CLOSE_BRACE && depth > 0) depth--;
    else if (c === SLASH && depth === 0 && i >= tail) return i;
  }
  return -1;
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
    domain: null,
    network: null,
    cidr4: null,
    cidr6: null,
    usesPtrMacro: false,
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
    const valuePosition = q + 2;
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
      if (term.argument === '') {
        term.problems.push({
          message: `The ${lower} modifier has nothing after its equals sign.`,
          position: valuePosition,
        });
      } else {
        term.domain = term.argument;
        const scan = scanDomainSpec(term.argument, valuePosition);
        term.usesPtrMacro = scan.usesPtr;
        if (scan.problem !== null) term.problems.push(scan.problem);
      }
    } else {
      term.kind = 'modifier';
      term.name = token;
      // unknown-modifier = name "=" macro-string: the value may be empty.
      const scan = scanMacroString(term.argument, valuePosition);
      term.usesPtrMacro = scan.usesPtr;
      if (scan.problem !== null) term.problems.push(scan.problem);
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
  const afterColon = q + 2;

  if (lower === 'all') {
    if (delimiter !== '') {
      term.problems.push({ message: 'The all mechanism takes nothing after its name.', position: q + 1 });
    }
    return term;
  }
  if (lower === 'ip4' || lower === 'ip6') {
    if (delimiter !== ':') {
      term.problems.push({
        message: `The ${lower} mechanism needs a colon and an address after its name.`,
        position: q + 1,
      });
      return term;
    }
    if (term.argument === '') {
      term.problems.push({ message: `The ${lower} mechanism has nothing after its colon.`, position: afterColon });
      return term;
    }
    const slash = term.argument.indexOf('/');
    const network = slash < 0 ? term.argument : term.argument.slice(0, slash);
    term.network = network;
    const valid = lower === 'ip4' ? isIp4Literal(network) : isIp6Literal(network);
    if (!valid) {
      term.problems.push({
        message:
          lower === 'ip4'
            ? 'This is not an IPv4 address: four numbers from 0 to 255 with no leading zeros, separated by periods (RFC 7208 section 12).'
            : 'This is not an IPv6 address in the forms of RFC 4291 section 2.2 (a zone id is not part of them).',
        position: afterColon,
      });
    }
    if (slash >= 0) {
      const length = readSingleCidr(
        term.argument.slice(slash),
        lower === 'ip4' ? 32 : 128,
        q + 1 + slash,
        term.problems,
      );
      if (lower === 'ip4') term.cidr4 = length;
      else term.cidr6 = length;
    }
    return term;
  }
  if (lower === 'include' || lower === 'exists') {
    if (delimiter !== ':') {
      term.problems.push({
        message: `The ${lower} mechanism needs a colon and a domain after its name.`,
        position: q + 1,
      });
      return term;
    }
    if (term.argument === '') {
      term.problems.push({ message: `The ${lower} mechanism has nothing after its colon.`, position: afterColon });
      return term;
    }
    term.domain = term.argument;
    const scan = scanDomainSpec(term.argument, afterColon);
    term.usesPtrMacro = scan.usesPtr;
    if (scan.problem !== null) term.problems.push(scan.problem);
    return term;
  }
  if (lower === 'ptr') {
    if (delimiter === '/') {
      term.problems.push({ message: 'The ptr mechanism takes no prefix length.', position: q + 1 });
      return term;
    }
    if (delimiter === ':') {
      if (term.argument === '') {
        term.problems.push({ message: 'The ptr mechanism has nothing after its colon.', position: afterColon });
        return term;
      }
      term.domain = term.argument;
      const scan = scanDomainSpec(term.argument, afterColon);
      term.usesPtrMacro = scan.usesPtr;
      if (scan.problem !== null) term.problems.push(scan.problem);
    }
    return term;
  }
  // a and mx: [ ":" domain-spec ] [ dual-cidr-length ]
  let cidrText = '';
  let cidrAt = 0;
  if (delimiter === ':') {
    if (term.argument === '') {
      term.problems.push({ message: `The ${lower} mechanism has nothing after its colon.`, position: afterColon });
      return term;
    }
    const split = cidrStart(term.argument);
    const domain = split < 0 ? term.argument : term.argument.slice(0, split);
    if (split >= 0) {
      cidrText = term.argument.slice(split);
      cidrAt = q + 1 + split;
    }
    if (domain === '') {
      term.problems.push({
        message: `The ${lower} mechanism has no domain between its colon and its prefix length.`,
        position: afterColon,
      });
    } else {
      term.domain = domain;
      const scan = scanDomainSpec(domain, afterColon);
      term.usesPtrMacro = scan.usesPtr;
      if (scan.problem !== null) term.problems.push(scan.problem);
    }
  } else if (delimiter === '/') {
    cidrText = term.argument;
    cidrAt = q;
  }
  if (cidrText !== '') {
    const lengths = readDualCidr(cidrText, cidrAt, term.problems);
    term.cidr4 = lengths.cidr4;
    term.cidr6 = lengths.cidr6;
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
