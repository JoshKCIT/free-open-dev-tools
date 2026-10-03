import meta from './meta.json';
import type { HashRule, Tier } from './rule';
import { DIGEST_RULES } from './rules-digests';
import { FRAMEWORK_RULES } from './rules-frameworks';
import { MODULAR_RULES } from './rules-modular';

export { meta };
export type { HashRule, Tier };

/** The longest paste read, in characters (256 KiB). A longer one is refused before it is split into lines. */
export const MAX_INPUT_CHARS = 262144;
/** The most lines read from one paste. A longer paste is refused before any line is looked at. */
export const MAX_LINES = 1000;
/** The longest line looked at. A longer line is reported as too long to be a hash. */
export const MAX_LINE_CHARS = 4096;
/** The most table rows one paste lists. The lines after it are counted and left out, and a note says so. */
export const MAX_ROWS = 2000;
/** How many characters of a line are echoed back as its preview. */
export const PREVIEW_CHARS = 12;

/** What the page says once for a paste that holds hexadecimal length-only candidates. */
export const NO_LABEL_SENTENCE =
  'A bare hex string carries no label; these are the algorithms that produce exactly this length, in the order they are most often met. Several are always possible.';

/** The same for Base64 digests. */
export const NO_LABEL_BASE64_SENTENCE =
  'A bare Base64 string carries no label either; these are the digests whose size gives exactly this length, in the order they are most often met. Several are always possible.';

/** The same for the two crypt shapes that have no marker, which are matched on length and alphabet alone. */
export const NO_LABEL_CRYPT_SENTENCE =
  'A string of ./0-9A-Za-z characters without a marker is matched on its length and alphabet alone; many other values (an ID, a number, a word) fit, so these are weak guesses.';

/** A paste the page refuses to read. The message is a plain sentence that never echoes the paste. */
export class HashIdentifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HashIdentifierError';
  }
}

/**
 * The rule table. The order here is the order candidates of the same tier are listed in: the modular and PHC formats, then
 * the framework and database formats, then the raw digests by length.
 */
export const RULES: readonly HashRule[] = [...MODULAR_RULES, ...FRAMEWORK_RULES, ...DIGEST_RULES];

export interface Candidate {
  ruleId: string;
  name: string;
  /** 1: a marker and field layout from a published format. 2: a specific shape. 3: the length of a digest only. */
  tier: Tier;
  /** Which marker matched and which fields were checked. */
  reason: string;
  /** The document the rule rests on. */
  source: string;
}

export type LineStatus = 'ok' | 'too-long' | 'not-ascii' | 'not-recognised';

export interface LineResult {
  /** The line's position in the paste, counting blank lines, starting at 1. */
  number: number;
  /** Characters in the trimmed line. */
  length: number;
  /** The first characters of the trimmed line, anything outside printable ASCII shown as a question mark. */
  preview: string;
  status: LineStatus;
  /** What happened to a line that was not recognised; empty for a line with candidates. */
  message: string;
  candidates: Candidate[];
}

export interface IdentifyResult {
  /** The non-blank lines that are listed, in paste order, up to MAX_ROWS rows. */
  lines: LineResult[];
  /** Blank lines (nothing but spaces and tabs) that were skipped. */
  blank: number;
  /** Non-blank lines read, listed or not. */
  read: number;
  /** Lines that have at least one candidate. */
  recognised: number;
  /** Non-blank lines with no candidate, whatever the reason. */
  notRecognised: number;
  /** Things worth knowing about the result, such as lines left out of the listing. */
  warnings: string[];
  /** Sentences that explain how to read the candidates. */
  notes: string[];
}

function withCommas(n: number): string {
  const digits = String(n);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}

/** Only spaces and tabs are trimmed; no other character counts as white space here. */
function trimLine(raw: string): string {
  let start = 0;
  let end = raw.length;
  while (start < end && (raw.charCodeAt(start) === 32 || raw.charCodeAt(start) === 9)) start++;
  while (end > start && (raw.charCodeAt(end - 1) === 32 || raw.charCodeAt(end - 1) === 9)) end--;
  return start === 0 && end === raw.length ? raw : raw.slice(start, end);
}

function isPrintableAscii(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

function previewOf(line: string): string {
  let out = '';
  const n = Math.min(line.length, PREVIEW_CHARS);
  for (let i = 0; i < n; i++) {
    const code = line.charCodeAt(i);
    out += code < 32 || code > 126 ? '?' : line.charAt(i);
  }
  return out;
}

/** The rules that match a string on its length and its ./0-9A-Za-z alphabet alone (tier 3, but not digests). */
const CRYPT_LENGTH_RULES: ReadonlySet<string> = new Set([
  'descrypt',
  'bigcrypt',
  'ldap-crypt/descrypt',
  'ldap-crypt/bigcrypt',
]);

/** Runs every rule and sorts by tier, then by the rule's place in the table. The sort is stable and the table is fixed. */
function rank(line: string): Candidate[] {
  const found: { candidate: Candidate; index: number }[] = [];
  for (let index = 0; index < RULES.length; index++) {
    const r = RULES[index];
    if (r === undefined) continue;
    const match = r.test(line);
    if (match !== null) {
      found.push({
        candidate: { ruleId: r.id, name: r.name, tier: match.tier ?? r.tier, reason: match.reason, source: r.source },
        index,
      });
    }
  }
  found.sort((a, b) => a.candidate.tier - b.candidate.tier || a.index - b.index);
  return found.map((f) => f.candidate);
}

/**
 * The candidates for one line, best evidence first. Spaces and tabs around the line are trimmed; a line that is empty, longer
 * than MAX_LINE_CHARS or holds a character outside printable ASCII has none.
 */
export function identifyLine(line: string): Candidate[] {
  const trimmed = trimLine(line);
  if (trimmed.length === 0 || trimmed.length > MAX_LINE_CHARS || !isPrintableAscii(trimmed)) return [];
  return rank(trimmed);
}

/** Splits a paste into lines: a line feed or a carriage return plus line feed ends a line, and the last break starts no new one. */
function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const pieces = text.split('\n');
  if (text.endsWith('\n')) pieces.pop();
  return pieces.map((piece) => (piece.endsWith('\r') ? piece.slice(0, -1) : piece));
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let breaks = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) breaks++;
  return text.endsWith('\n') ? breaks : breaks + 1;
}

/**
 * Identifies every line of a paste. The limits are checked before any line is parsed: a paste over MAX_INPUT_CHARS characters
 * or MAX_LINES lines is refused with a HashIdentifierError.
 */
export function identifyText(text: string): IdentifyResult {
  if (text.length > MAX_INPUT_CHARS) {
    throw new HashIdentifierError(
      `This paste is ${withCommas(text.length)} characters. The limit is ${withCommas(MAX_INPUT_CHARS)} because longer pastes are not lists of hashes.`,
    );
  }
  const total = countLines(text);
  if (total > MAX_LINES) {
    throw new HashIdentifierError(`This paste has ${withCommas(total)} lines. The limit is ${withCommas(MAX_LINES)}.`);
  }

  const lines: LineResult[] = [];
  let blank = 0;
  let read = 0;
  let recognised = 0;
  let rows = 0;
  let omitted = 0;
  let full = false;
  let hexLength = false;
  let base64Length = false;
  let cryptLength = false;

  const pieces = splitLines(text);
  for (let i = 0; i < pieces.length; i++) {
    const line = trimLine(pieces[i] ?? '');
    if (line.length === 0) {
      blank++;
      continue;
    }
    read++;
    let status: LineStatus;
    let message = '';
    let candidates: Candidate[] = [];
    if (line.length > MAX_LINE_CHARS) {
      status = 'too-long';
      message = `This line is ${withCommas(line.length)} characters. A hash string is at most ${withCommas(MAX_LINE_CHARS)} characters, so it is not read.`;
    } else if (!isPrintableAscii(line)) {
      status = 'not-ascii';
      message =
        'This line holds a character that is not printable ASCII (a space up to a tilde), so it is not a hash string.';
    } else {
      candidates = rank(line);
      if (candidates.length > 0) status = 'ok';
      else {
        status = 'not-recognised';
        message =
          'This line matches no rule in the table. It may be a salted or keyed digest, a format this page does not know, or not a hash at all.';
      }
    }
    if (status === 'ok') recognised++;

    const cost = Math.max(1, candidates.length);
    if (full || rows + cost > MAX_ROWS) {
      full = true;
      omitted++;
      continue;
    }
    rows += cost;
    for (const c of candidates) {
      if (c.tier === 3) {
        if (c.ruleId.startsWith('b64-')) base64Length = true;
        else if (CRYPT_LENGTH_RULES.has(c.ruleId)) cryptLength = true;
        else hexLength = true;
      }
    }
    lines.push({ number: i + 1, length: line.length, preview: previewOf(line), status, message, candidates });
  }

  const warnings: string[] = [];
  if (omitted > 0) {
    warnings.push(
      `The table stops at ${withCommas(MAX_ROWS)} rows. ${withCommas(omitted)} more ${omitted === 1 ? 'line is' : 'lines are'} read and counted but not listed.`,
    );
  }
  const notes: string[] = [];
  if (hexLength) notes.push(NO_LABEL_SENTENCE);
  if (base64Length) notes.push(NO_LABEL_BASE64_SENTENCE);
  if (cryptLength) notes.push(NO_LABEL_CRYPT_SENTENCE);
  return { lines, blank, read, recognised, notRecognised: read - recognised, warnings, notes };
}
