import { toASCII, toUnicode } from 'tr46';
import { IdnConverterError } from './errors';
import { explainName } from './explain';
import type { LabelProblem } from './explain';
import { checkSizes, forEachLine, trimName } from './limits';
import { PROFILES } from './profiles';
import type { Profile, ProfileId } from './profiles';

/** Which way to convert: `auto` goes by what each name holds. */
export type Direction = 'auto' | 'to-ascii' | 'to-unicode';

/** The way one name was judged: `both` is a name that is plain ASCII and has no xn-- label, so either way applies. */
export type ResolvedDirection = 'to-ascii' | 'to-unicode' | 'both';

export interface ConvertOptions {
  direction: Direction;
  profile: ProfileId;
}

export interface ConvertedName {
  /** The line of the pasted text the name is on, counting every line (blank ones too), from 1. */
  line: number;
  /** The name as pasted, with surrounding ASCII spaces, tabs and carriage returns taken off. */
  input: string;
  /** How the name was judged. */
  direction: ResolvedDirection;
  /** The ASCII form, or null when the name is not valid. */
  ascii: string | null;
  /** The Unicode form (mapped and in normalization form C), or null when the name is not valid. */
  unicode: string | null;
  valid: boolean;
  /** Why the name is not valid, in the rule families of the Unicode conformance data; empty when it is valid. */
  problems: LabelProblem[];
}

const DIRECTIONS: ReadonlySet<string> = new Set(['auto', 'to-ascii', 'to-unicode']);

function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return true;
  return false;
}

/** A name with only ASCII characters has an xn-- label when one of its labels starts that way (case does not matter). */
function hasPunycodeLabel(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('xn--') || lower.includes('.xn--');
}

function resolveDirection(name: string, direction: Direction): ResolvedDirection {
  if (direction !== 'auto') return direction;
  if (hasNonAscii(name)) return 'to-ascii';
  return hasPunycodeLabel(name) ? 'to-unicode' : 'both';
}

function chosenProfile(id: ProfileId): Profile {
  const profile = PROFILES.get(id);
  if (profile === undefined) throw new IdnConverterError('Choose the strict profile or the browser profile.');
  return profile;
}

function checkDirection(direction: Direction): void {
  if (!DIRECTIONS.has(direction))
    throw new IdnConverterError('Choose automatic, Unicode to ASCII, or ASCII to Unicode.');
}

/**
 * Converts one name (it is not trimmed or split) with the Unicode UTS #46 rules. A name going to Unicode is judged with
 * the profile's checks and no lengths (UTS #46 ToUnicode has none); every other name is judged as ToASCII, which holds
 * every ToUnicode check as well, so a plain ASCII name with no xn-- label is judged by both. A name that is not valid has no
 * ASCII or Unicode form and a list of problems; the list is empty exactly when the name is valid.
 */
export function convertName(name: string, options: ConvertOptions, line = 1): ConvertedName {
  checkDirection(options.direction);
  const profile = chosenProfile(options.profile);
  const resolved = resolveDirection(name, options.direction);
  const problems = explainName(name, profile, resolved === 'to-unicode' ? 'to-unicode' : 'to-ascii');
  if (problems.length > 0)
    return { line, input: name, direction: resolved, ascii: null, unicode: null, valid: false, problems };
  return {
    line,
    input: name,
    direction: resolved,
    // Lengths were judged above when they apply, so the forms are made without a second length check.
    ascii: toASCII(name, { ...profile, verifyDNSLength: false }),
    unicode: toUnicode(name, profile).domain,
    valid: true,
    problems,
  };
}

/**
 * Converts a pasted list of names, one per line. Blank lines are skipped, each name has the ASCII spaces, tabs and carriage
 * returns around it taken off (no other character is dropped: a no-break space at an end is judged with the name), and the line numbers count every line. The options are checked and the text is size-checked first, so a refused
 * paste is refused before anything is converted.
 */
export function convertNames(text: string, options: ConvertOptions): ConvertedName[] {
  checkDirection(options.direction);
  chosenProfile(options.profile);
  checkSizes(text);
  const rows: ConvertedName[] = [];
  forEachLine(text, (lineText, number) => {
    const name = trimName(lineText);
    if (name === '') return;
    rows.push(convertName(name, options, number));
  });
  return rows;
}
