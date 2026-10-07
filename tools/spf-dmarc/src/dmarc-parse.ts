import { checkRecordLength } from './limits';

/**
 * What the tags table says about one tag: `ok` (read and valid), `default-used` (not in the record, so its default applies),
 * `retired` (a tag RFC 9989 removed), `unknown` (not a tag of RFC 9989, so ignored), `invalid` (its value is wrong, so it is
 * ignored and the default applies) or `repeated` (a second or later copy of a tag, ignored because the first value is used).
 */
export type DmarcStatus = 'ok' | 'default-used' | 'retired' | 'unknown' | 'invalid' | 'repeated';

/** One reporting address of a rua or ruf tag. */
export interface DmarcUri {
  /** The address as written, without the blanks around it and without any obsolete size suffix. */
  text: string;
  /** The scheme in lower case, or null when there is none. */
  scheme: string | null;
  kind: 'mailto' | 'other' | 'invalid';
  /** For a mailto address: the mailbox (the part before any ?), as written. */
  address: string | null;
  /** For a mailto address: the domain of the mailbox in lower case. */
  host: string | null;
  /** The obsolete report size suffix, such as !10m, or null (RFC 9989 sections 4.8 and C.4). */
  obsoleteSize: string | null;
  /** A fixed sentence when the address is not usable, else null. Never holds typed text. */
  problem: string | null;
}

export interface DmarcTag {
  /** The tag name as written. */
  name: string;
  /** The value as written, or null for a tag that is not in the record. */
  value: string | null;
  status: DmarcStatus;
  /** What the tag does with this value, in a fixed sentence. */
  meaning: string;
  /** The default shown in the Default column (RFC 9989 section 4.7), or an empty string for a tag with none. */
  default: string;
  /** The 1-based character where the tag starts in the record, or 0 for a tag that is not in the record. */
  position: number;
  /** The addresses of a rua or ruf tag in order, else an empty list. */
  uris: DmarcUri[];
  /** A fixed sentence saying what is wrong, else null. Never holds typed text. */
  problem: string | null;
}

export interface DmarcRecord {
  text: string;
  length: number;
  /** True when the text starts with the tag v=DMARC1 (RFC 9989 section 4.7). */
  isDmarc: boolean;
  /** Why the whole record is ignored, or null. */
  ignored: string | null;
  /** The tags in record order, then the tags that are absent in the order of RFC 9989 Table 2. */
  tags: DmarcTag[];
  /** The first copy of each tag of the record, by its name as written. A Map, so no tag name is special. */
  byName: ReadonlyMap<string, DmarcTag>;
  /** Things worth saying about how the record was read. */
  notes: string[];
}

/** The tags of RFC 9989 Table 2, in the order of the table. The version tag v always comes first and is not in the table. */
export const TABLE_2_ORDER: readonly string[] = ['p', 't', 'psd', 'np', 'sp', 'adkim', 'aspf', 'rua', 'ruf', 'fo'];

interface TagInfo {
  /** The default as the Default column shows it. */
  default: string;
  /** What the tag means when it is not in the record. */
  absent: string;
}

const TAGS: ReadonlyMap<string, TagInfo> = new Map<string, TagInfo>([
  ['v', { default: '', absent: 'Required: a record without v=DMARC1 first is ignored.' }],
  ['p', { default: 'none', absent: 'Not in the record, so the record is treated as p=none.' }],
  ['t', { default: 'n', absent: 'Not in the record: the policy is applied as written.' }],
  ['psd', { default: 'u', absent: 'Not in the record: the domain is not marked as a public suffix domain.' }],
  [
    'np',
    {
      default: 'sp, then p',
      absent: 'Not in the record: non-existent subdomains follow sp, or p when there is no sp.',
    },
  ],
  ['sp', { default: 'p', absent: 'Not in the record: existing subdomains follow p.' }],
  ['adkim', { default: 'r', absent: 'Not in the record: relaxed DKIM alignment.' }],
  ['aspf', { default: 'r', absent: 'Not in the record: relaxed SPF alignment.' }],
  ['rua', { default: 'none (no reports requested)', absent: 'Not in the record: no aggregate reports are requested.' }],
  ['ruf', { default: 'none (no reports requested)', absent: 'Not in the record: no failure reports are requested.' }],
  ['fo', { default: '0', absent: 'Not in the record: a failure report is asked for only when every mechanism fails.' }],
]);

/** The tags RFC 9989 removed (Appendix C.5.2), with what RFC 7489 used them for. */
const RETIRED: ReadonlyMap<string, string> = new Map<string, string>([
  [
    'pct',
    'The percentage of failing mail the policy applies to in RFC 7489. Retired in RFC 9989: t=y replaces some of it.',
  ],
  ['rf', 'The format of failure reports in RFC 7489. Retired in RFC 9989.'],
  ['ri', 'The interval between aggregate reports in RFC 7489. Retired in RFC 9989.'],
]);

const RETIRED_SUFFIX = ' Receivers that still follow RFC 7489 read it; others ignore it.';

const IGNORED_NOT_FIRST =
  'The record must start with the v tag, v=DMARC1, so the whole record is ignored (RFC 9989 section 4.7).';
const IGNORED_LOWER_V =
  'Tag names are read in lower case here, so this is not the v tag, and the whole record is ignored (RFC 9989 section 4.7).';
const IGNORED_CASE =
  'The value of v is case sensitive and must be exactly DMARC1, so the whole record is ignored (RFC 9989 section 4.7).';
const IGNORED_VALUE = 'The only value of v is DMARC1, so the whole record is ignored (RFC 9989 section 4.7).';

const PROBLEM_NO_EQUALS = 'This is not a tag: it has no equals sign.';
const PROBLEM_NO_NAME = 'The tag has no name.';
const PROBLEM_NAME = 'A tag name is made of letters only.';
const PROBLEM_NO_VALUE = 'The tag has no value.';
const PROBLEM_CHARACTER =
  'The value holds a character a DMARC value cannot hold: only printing ASCII characters are allowed.';
const PROBLEM_POLICY = 'The value must be none, quarantine or reject.';
const PROBLEM_YN = 'The value must be y or n.';
const PROBLEM_PSD = 'The value must be y, n or u.';
const PROBLEM_RS = 'The value must be r or s.';
const PROBLEM_NO_URI = 'No address in this tag is a usable URI.';
const PROBLEM_FO_VALUES = 'The value can hold only 0, 1, d and s, separated by colons.';
const PROBLEM_FO_TOGETHER = 'The values 0 and 1 cannot be used together.';
const PROBLEM_FO_ONCE_01 = 'Only one of 0 or 1 is allowed: each of 0 and 1 can appear once.';
const PROBLEM_FO_ONCE_DS = 'The values d and s can each appear once.';

function isWsp(code: number): boolean {
  return code === 32 || code === 9;
}

function isAlpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isLdh(code: number): boolean {
  return isAlpha(code) || isDigit(code) || code === 45;
}

/** The text between two positions with the blanks (space and tab) taken off both ends. */
function trimmed(text: string, from: number, to: number): { value: string; start: number } {
  let a = from;
  let b = to;
  while (a < b && isWsp(text.charCodeAt(a))) a++;
  while (b > a && isWsp(text.charCodeAt(b - 1))) b--;
  return { value: text.slice(a, b), start: a };
}

/** The place of the obsolete size suffix at the end of an address (an exclamation mark, digits, k m g or t), or -1. */
function sizeSuffixAt(entry: string): number {
  let j = entry.length;
  if (j > 0 && 'kmgtKMGT'.includes(entry.charAt(j - 1))) j--;
  const digitsEnd = j;
  while (j > 0 && isDigit(entry.charCodeAt(j - 1))) j--;
  if (j === digitsEnd || j === 0 || entry.charCodeAt(j - 1) !== 33) return -1;
  return j - 1;
}

/**
 * A host as RFC 5321 writes a domain: labels of letters, digits and hyphens, 1 to 63 characters each, none starting or
 * ending with a hyphen, at most 253 characters in all.
 */
export function isMailHost(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  let start = 0;
  for (;;) {
    let end = host.indexOf('.', start);
    if (end < 0) end = host.length;
    const size = end - start;
    if (size < 1 || size > 63) return false;
    if (host.charCodeAt(start) === 45 || host.charCodeAt(end - 1) === 45) return false;
    for (let k = start; k < end; k++) if (!isLdh(host.charCodeAt(k))) return false;
    if (end === host.length) return true;
    start = end + 1;
  }
}

function invalidUri(text: string, obsoleteSize: string | null, problem: string): DmarcUri {
  return { text, scheme: null, kind: 'invalid', address: null, host: null, obsoleteSize, problem };
}

function readUri(text: string, obsoleteSize: string | null): DmarcUri {
  if (text === '') return invalidUri(text, obsoleteSize, 'An address is empty.');
  for (let k = 0; k < text.length; k++) {
    if (isWsp(text.charCodeAt(k))) return invalidUri(text, obsoleteSize, 'A URI cannot hold a blank.');
  }
  let k = 0;
  while (
    k < text.length &&
    (isAlpha(text.charCodeAt(k)) || (k > 0 && (isDigit(text.charCodeAt(k)) || '+-.'.includes(text.charAt(k)))))
  )
    k++;
  const scheme = k > 0 && text.charCodeAt(k) === 58 ? text.slice(0, k).toLowerCase() : null;
  if (scheme === null) {
    return invalidUri(
      text,
      obsoleteSize,
      text.includes('@')
        ? 'This looks like a bare mail address: a reporting address is a URI, so it needs the mailto: scheme.'
        : 'This is not a URI: it has no scheme such as mailto:.',
    );
  }
  if (scheme !== 'mailto') {
    return { text, scheme, kind: 'other', address: null, host: null, obsoleteSize, problem: null };
  }
  const rest = text.slice(k + 1);
  const q = rest.indexOf('?');
  const address = q < 0 ? rest : rest.slice(0, q);
  const at = address.lastIndexOf('@');
  let problem: string | null = null;
  if (at < 0) problem = 'The mailto address has no @ sign.';
  else if (at === 0) problem = 'The mailto address has no mailbox before the @ sign.';
  else if (at === address.length - 1) problem = 'The mailto address has no domain after the @ sign.';
  else if (!isMailHost(address.slice(at + 1))) problem = 'The mailto address has no valid domain.';
  return {
    text,
    scheme,
    kind: problem === null ? 'mailto' : 'invalid',
    address,
    host: problem === null ? address.slice(at + 1).toLowerCase() : null,
    obsoleteSize,
    problem,
  };
}

/**
 * Reads the value of a rua or ruf tag: addresses separated by commas with blanks allowed around each comma (RFC 9989
 * section 4.8, dmarc-urilist). The mailto addresses are checked for a mailbox and a domain; other schemes are kept as
 * written. Nothing is looked up.
 */
export function parseUriList(value: string): DmarcUri[] {
  const out: DmarcUri[] = [];
  const n = value.length;
  let i = 0;
  for (;;) {
    let end = value.indexOf(',', i);
    if (end < 0) end = n;
    const entry = trimmed(value, i, end).value;
    let text = entry;
    let obsoleteSize: string | null = null;
    const bang = sizeSuffixAt(entry);
    if (bang >= 0) {
      obsoleteSize = entry.slice(bang);
      text = entry.slice(0, bang);
    }
    out.push(readUri(text, obsoleteSize));
    if (end === n) break;
    i = end + 1;
  }
  return out;
}

function policyWords(value: string): string {
  const v = value.toLowerCase();
  if (v === 'none') return 'no action is requested for mail that fails DMARC (monitoring)';
  if (v === 'quarantine') return 'mail that fails DMARC is treated as suspicious';
  return 'mail that fails DMARC is treated as not valid';
}

const FO_WORDS: ReadonlyMap<string, string> = new Map<string, string>([
  ['0', 'every mechanism fails to give an aligned pass'],
  ['1', 'any mechanism fails to give an aligned pass'],
  ['d', 'a DKIM signature fails'],
  ['s', 'SPF fails'],
]);

/** What is wrong with the value of fo (RFC 9989 section 4.8, dmarc-fo), or null. */
function foProblem(value: string): string | null {
  let zero = 0;
  let one = 0;
  let d = 0;
  let s = 0;
  let start = 0;
  for (;;) {
    let end = value.indexOf(':', start);
    if (end < 0) end = value.length;
    const part = value.slice(start, end).toLowerCase();
    if (part === '0') zero++;
    else if (part === '1') one++;
    else if (part === 'd') d++;
    else if (part === 's') s++;
    else return PROBLEM_FO_VALUES;
    if (end === value.length) break;
    start = end + 1;
  }
  if (zero > 0 && one > 0) return PROBLEM_FO_TOGETHER;
  if (zero > 1 || one > 1) return PROBLEM_FO_ONCE_01;
  if (d > 1 || s > 1) return PROBLEM_FO_ONCE_DS;
  return null;
}

/** What is wrong with a value made only of the characters a DMARC value can hold (RFC 9989 section 4.8), or null. */
function characterProblem(value: string): string | null {
  if (value === '') return PROBLEM_NO_VALUE;
  for (let k = 0; k < value.length; k++) {
    const c = value.charCodeAt(k);
    if (c < 0x20 || c > 0x7e) return PROBLEM_CHARACTER;
  }
  return null;
}

/** What is wrong with the value of a known tag (RFC 9989 section 4.8, Table 2), or null. Rua and ruf are judged by their addresses. */
function valueProblem(name: string, value: string): string | null {
  const characters = characterProblem(value);
  if (characters !== null) return characters;
  const v = value.toLowerCase();
  switch (name) {
    case 'p':
    case 'sp':
    case 'np':
      return v === 'none' || v === 'quarantine' || v === 'reject' ? null : PROBLEM_POLICY;
    case 't':
      return v === 'y' || v === 'n' ? null : PROBLEM_YN;
    case 'psd':
      return v === 'y' || v === 'n' || v === 'u' ? null : PROBLEM_PSD;
    case 'adkim':
    case 'aspf':
      return v === 'r' || v === 's' ? null : PROBLEM_RS;
    case 'fo':
      return foProblem(value);
    default:
      return null;
  }
}

function alignment(value: string, what: string): string {
  return value.toLowerCase() === 'r'
    ? `Relaxed ${what} alignment: the domains only need the same organizational domain.`
    : `Strict ${what} alignment: the domains must be identical.`;
}

function addressCount(uris: DmarcUri[]): string {
  const n = uris.filter((u) => u.kind !== 'invalid').length;
  return `${n} usable address${n === 1 ? '' : 'es'}`;
}

/** What a valid tag does with its value, in a fixed sentence. */
function meaningOf(name: string, value: string, uris: DmarcUri[]): string {
  switch (name) {
    case 'v':
      return 'Version. It must be the first tag and its only value is DMARC1.';
    case 'p':
      return `Policy for the domain itself: ${policyWords(value)}.`;
    case 'sp':
      return `Policy for existing subdomains: ${policyWords(value)}.`;
    case 'np':
      return `Policy for non-existent subdomains: ${policyWords(value)}.`;
    case 't':
      return value.toLowerCase() === 'y'
        ? 'Testing: the policy is not applied, and failing mail gets the policy one level below it.'
        : 'Not testing: the policy is applied as written.';
    case 'psd': {
      const v = value.toLowerCase();
      if (v === 'y') return 'The domain is a public suffix domain (PSD).';
      if (v === 'n') return 'Not a PSD, and it is the organizational domain for itself and its subdomains.';
      return 'Not a PSD, and it may or may not be the organizational domain; the tree walk decides.';
    }
    case 'adkim':
      return alignment(value, 'DKIM');
    case 'aspf':
      return alignment(value, 'SPF');
    case 'rua':
      return `Where aggregate reports are requested: ${addressCount(uris)}.`;
    case 'ruf':
      return `Where failure reports are requested: ${addressCount(uris)}.`;
    case 'fo': {
      const words: string[] = [];
      let start = 0;
      for (;;) {
        let end = value.indexOf(':', start);
        if (end < 0) end = value.length;
        words.push(FO_WORDS.get(value.slice(start, end).toLowerCase()) ?? '');
        if (end === value.length) break;
        start = end + 1;
      }
      return `A failure report is requested when ${words.join(', or when ')}.`;
    }
    default:
      return '';
  }
}

/** The first problem with the version tag, or null when the text starts with v=DMARC1. */
function versionProblem(part: string): string | null {
  const eq = part.indexOf('=');
  if (eq < 0) return IGNORED_NOT_FIRST;
  const name = trimmed(part, 0, eq).value;
  const value = trimmed(part, eq + 1, part.length).value;
  if (name !== 'v') return name.toLowerCase() === 'v' ? IGNORED_LOWER_V : IGNORED_NOT_FIRST;
  if (value === 'DMARC1') return null;
  return value.toLowerCase() === 'dmarc1' ? IGNORED_CASE : IGNORED_VALUE;
}

/** Reads one non-empty element: a tag, whatever its state. */
function readTag(part: string, position: number, seen: ReadonlyMap<string, DmarcTag>): DmarcTag {
  const make = (
    name: string,
    value: string,
    status: DmarcStatus,
    meaning: string,
    problem: string | null,
    uris: DmarcUri[] = [],
  ): DmarcTag => ({
    name,
    value,
    status,
    meaning,
    default: TAGS.get(name)?.default ?? '',
    position,
    uris,
    problem,
  });
  const bad = (name: string, value: string, problem: string, uris: DmarcUri[] = []): DmarcTag =>
    make(
      name,
      value,
      'invalid',
      `${problem} ${TAGS.has(name) ? 'The default is used.' : 'It is ignored.'}`,
      problem,
      uris,
    );
  const eq = part.indexOf('=');
  if (eq < 0) return bad(part, '', PROBLEM_NO_EQUALS);
  const name = trimmed(part, 0, eq).value;
  const value = trimmed(part, eq + 1, part.length).value;
  if (name === '') return bad(name, value, PROBLEM_NO_NAME);
  for (let k = 0; k < name.length; k++) if (!isAlpha(name.charCodeAt(k))) return bad(name, value, PROBLEM_NAME);
  const retired = RETIRED.get(name);
  if (!TAGS.has(name) && retired === undefined) {
    const lower = name.toLowerCase();
    return make(
      name,
      value,
      'unknown',
      TAGS.has(lower) || RETIRED.has(lower)
        ? 'Tag names are read in lower case here, so this is an unknown tag and is ignored.'
        : 'Not a tag of RFC 9989, so it is ignored.',
      null,
    );
  }
  if (seen.has(name)) {
    return make(name, value, 'repeated', 'Repeated: only the first value is used, and this one is ignored.', null);
  }
  if (retired !== undefined) return make(name, value, 'retired', retired + RETIRED_SUFFIX, null);
  if (name === 'rua' || name === 'ruf') {
    const characters = characterProblem(value);
    if (characters !== null) return bad(name, value, characters);
    const uris = parseUriList(value);
    if (uris.every((u) => u.kind === 'invalid')) return bad(name, value, PROBLEM_NO_URI, uris);
    return make(name, value, 'ok', meaningOf(name, value, uris), null, uris);
  }
  const problem = valueProblem(name, value);
  if (problem !== null) return bad(name, value, problem);
  return make(name, value, 'ok', meaningOf(name, value, []), null);
}

/**
 * Reads one DMARC record in a single pass. The tags come out in record order, then every tag the record does not hold with
 * its default, in the order of RFC 9989 Table 2. A record that does not start with v=DMARC1 is ignored as a whole. Tag names
 * are read in lower case, and a repeated tag keeps its first value, because RFC 9989 says neither.
 */
export function parseDmarc(text: string): DmarcRecord {
  checkRecordLength(text, 'dmarc');
  const byName = new Map<string, DmarcTag>();
  const record: DmarcRecord = {
    text,
    length: text.length,
    isDmarc: false,
    ignored: null,
    tags: [],
    byName,
    notes: [],
  };
  const n = text.length;
  let i = 0;
  while (i < n && isWsp(text.charCodeAt(i))) i++;
  const leading = i;
  let element = 0;
  let empty = 0;
  for (;;) {
    let end = text.indexOf(';', i);
    if (end < 0) end = n;
    const { value: part, start } = trimmed(text, i, end);
    if (element === 0) {
      const reason = versionProblem(part);
      if (reason !== null) {
        record.ignored = reason;
        return record;
      }
      record.isDmarc = true;
      if (leading > 0) record.notes.push('Blanks before v=DMARC1 were ignored.');
    }
    if (part === '') {
      if (end !== n && element > 0) empty++;
    } else {
      const tag = readTag(part, start + 1, byName);
      record.tags.push(tag);
      if (!byName.has(tag.name)) byName.set(tag.name, tag);
    }
    element++;
    if (end === n) break;
    i = end + 1;
  }
  if (empty > 0) {
    record.notes.push(
      empty === 1
        ? 'An empty element between two semicolons was ignored (RFC 9989 section 4.8 does not allow one).'
        : `${empty} empty elements between semicolons were ignored (RFC 9989 section 4.8 does not allow them).`,
    );
  }
  for (const name of TABLE_2_ORDER) {
    const info = TAGS.get(name);
    if (info === undefined || byName.has(name)) continue;
    record.tags.push({
      name,
      value: null,
      status: 'default-used',
      meaning: info.absent,
      default: info.default,
      position: 0,
      uris: [],
      problem: null,
    });
  }
  return record;
}
