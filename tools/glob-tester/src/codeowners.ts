import { GlobTesterError } from './errors';
import { MAX_PATH_CHARACTERS, MAX_PATH_LINES, MAX_PATH_PASTE_CHARACTERS, withCommas } from './limits';
import { checkPath, forEachLine, isBlank } from './lines';
import { MAX_SHOWN_PATTERN, visible } from './visible';

/**
 * CODEOWNERS mode: which owners a CODEOWNERS file gives each pasted path, and which line decided it, following the rules
 * GitHub documents in "About code owners": the last line that matches a path decides, the owners of earlier lines are never
 * merged, a line with no owners leaves its paths with no owner, paths are case sensitive, and a line GitHub cannot read is
 * skipped. Behaviour GitHub does not document (runs of double stars and slashes, a question mark, other backslash
 * escapes, the exact shape of an owner) is this page's reading, and each place it is used is marked.
 *
 * Nothing here builds a regular expression from pasted text. A pattern is compiled to a short list of tokens, cut at its
 * stars into parts, and matched against the path's segments and, inside one segment, against its characters. The part
 * before the first star must start the text, the part after the last star must end it, and each part in between is
 * looked for from left to right at the first place it fits, which is what the usual two-pointer walk for wildcards finds
 * too. A part made only of plain characters, or only of plain names, is found with the Knuth-Morris-Pratt search in one
 * pass over the text. A part that holds a ?, a name with wildcards in it, or a token for any one directory is tried at
 * each place in turn, so one such pattern and one path can cost about the product of their two lengths. No search is
 * ever exponential, and every step is counted: one paste may take at most MAX_CODEOWNERS_WORK steps, and a paste that
 * needs more is refused with a fixed sentence instead of running on.
 */

/** The most CODEOWNERS text that is read. GitHub itself does not load a file of 3 MB or more; a paste this size is no longer a quick check. */
export const MAX_CODEOWNERS_CHARACTERS = 600_000;
/** The most rules (lines that are neither blank nor a comment). */
export const MAX_CODEOWNERS_RULES = 5_000;
/** The longest rule line. A comment line or a blank line may be longer: GitHub skips it, and so does this page. */
export const MAX_CODEOWNERS_LINE_CHARACTERS = 4_000;
/**
 * The most matching work one paste may take, in steps: one for each rule tried on each path, one for each time part of a
 * pattern is laid at a place, one for each name or character looked at there or by a search, and one for each step back
 * of a search. A paste that needs more is refused, naming the path line where matching stopped, so no paste inside the
 * other limits can keep the page or a script busy for long: on the machine that set it, a step took 3 to 7 nanoseconds,
 * so the whole budget takes about 1 to 2 seconds, well inside the page's 5 second stop. 5,000 folder rules against 5,000
 * paths of eight folders need 75 to 250 million steps and are answered.
 */
export const MAX_CODEOWNERS_WORK = 300_000_000;

/** The work counter for one paste: the steps used so far. */
export interface CodeownersWork {
  used: number;
}

/** One CODEOWNERS line that is a rule. */
export interface CodeownersRule {
  /** The pasted line number, counting every line (comments and blank lines too). */
  line: number;
  pattern: string;
  /** The owners, in pasted order. Empty when the line names none (which leaves its paths with no owner). */
  owners: string[];
  /** Empty, or the words that mark a reading GitHub does not document (shown beside every row this line decides). */
  note: string;
  /** Whether a path (written with forward slashes, no trailing slash) is matched by this line. */
  matches(path: string): boolean;
  /**
   * The same question for a path already split at its slashes (what ownersForPaths asks many times over). The steps it
   * takes are added to `work` when one is given, so a caller can bound a whole paste.
   */
  matchesSegments(segments: readonly string[], work?: CodeownersWork): boolean;
}

/** A line that is not a rule: GitHub does not support it, or it holds something that cannot be read. */
export interface SkippedLine {
  line: number;
  /** The pasted line, made safe to show and cut at 40 characters. */
  shown: string;
  /** Plain words; never holds pasted text. */
  reason: string;
  /** True when GitHub's page says so; false when this page decided it and GitHub does not document it. */
  documented: boolean;
}

/** The answer for one path. */
export interface CodeownersRow {
  path: string;
  owners: string[];
  /** The deciding line, or null when no line matched at all. A line with no owners decides too: owners is then empty. */
  line: number | null;
  /** The pattern of the deciding line, or an empty string when none matched. */
  pattern: string;
  /** Words marking a deciding line that rests on a reading GitHub does not document; empty otherwise. */
  note: string;
}

const SPACE = 32;
const TAB = 9;
const BACKSLASH = 92;
const STAR = 42;
const HASH = 35;

const NOT_DOCUMENTED = 'not documented by GitHub';

const AT = 64;

function isSeparator(code: number): boolean {
  return code === SPACE || code === TAB;
}

// ---------------------------------------------------------------------------------------------------------------------
// Owners: `@username`, `@org/team-name` or an email address. How exactly each may be written is not documented by GitHub;
// these checks are this page's loose reading, written as character tests and never as a regular expression, so no owner
// can make them slow.
// ---------------------------------------------------------------------------------------------------------------------

function isNameCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 45 ||
    code === 95 ||
    code === 46
  );
}

/** Whether text[from, to) is one or more letters, digits, hyphens, underscores or dots. */
function isNameOnly(text: string, from: number, to: number): boolean {
  if (to <= from) return false;
  for (let i = from; i < to; i++) {
    if (!isNameCharacter(text.charCodeAt(i))) return false;
  }
  return true;
}

/** Whether text[from, to) is one or more letters, digits or hyphens (one part of an email domain). */
function isDomainLabel(text: string, from: number, to: number): boolean {
  if (to <= from) return false;
  for (let i = from; i < to; i++) {
    const code = text.charCodeAt(i);
    const letterOrDigit = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!letterOrDigit && code !== 45) return false;
  }
  return true;
}

/**
 * The three owner forms GitHub's page names. A name holds letters, digits, hyphen, underscore and dot; an email address has
 * one @, something before it that holds no slash, and a domain of at least two parts joined by dots.
 */
export const OWNER_SHAPES: readonly { shape: 'user' | 'team' | 'email'; accepts(owner: string): boolean }[] = [
  {
    shape: 'user',
    accepts(owner) {
      return owner.charCodeAt(0) === AT && isNameOnly(owner, 1, owner.length);
    },
  },
  {
    shape: 'team',
    accepts(owner) {
      if (owner.charCodeAt(0) !== AT) return false;
      const slash = owner.indexOf('/');
      if (slash < 0 || owner.indexOf('/', slash + 1) >= 0) return false;
      return isNameOnly(owner, 1, slash) && isNameOnly(owner, slash + 1, owner.length);
    },
  },
  {
    shape: 'email',
    accepts(owner) {
      const at = owner.indexOf('@');
      if (at < 1 || owner.indexOf('@', at + 1) >= 0 || owner.indexOf('/') >= 0) return false;
      let from = at + 1;
      let parts = 0;
      for (;;) {
        const dot = owner.indexOf('.', from);
        const to = dot < 0 ? owner.length : dot;
        if (!isDomainLabel(owner, from, to)) return false;
        parts += 1;
        if (dot < 0) break;
        from = dot + 1;
      }
      return parts >= 2;
    },
  },
];

function isOwner(owner: string): boolean {
  return OWNER_SHAPES.some((shape) => shape.accepts(owner));
}

// ---------------------------------------------------------------------------------------------------------------------
// Matching one path segment against a segment of the pattern: `*` is any characters, `?` is one character, a backslash
// takes the next character literally. Characters are compared by UTF-16 unit, and `?` and a star step over a surrogate
// pair as one character, so a star never ends, and `?` never takes, half of an emoji.
// ---------------------------------------------------------------------------------------------------------------------

const ANY_CHARACTER = -1;
const ANY_RUN = -2;

/** What a part tried at one place gives when it does not fit there: a character differs, or the text ran out first. */
const MISMATCH = -1;
const RAN_OUT = -2;

function unitsAt(text: string, index: number): number {
  const high = text.charCodeAt(index);
  if (high >= 0xd800 && high <= 0xdbff && index + 1 < text.length) {
    const low = text.charCodeAt(index + 1);
    if (low >= 0xdc00 && low <= 0xdfff) return 2;
  }
  return 1;
}

/**
 * Whether a star that began at `from` can end at `at`: it steps over whole characters, so `at` must not be the second
 * half of a surrogate pair that starts at or after `from`.
 */
function startsCharacter(text: string, from: number, at: number): boolean {
  if (at <= from) return true;
  const before = text.charCodeAt(at - 1);
  const here = text.charCodeAt(at);
  return !(before >= 0xd800 && before <= 0xdbff && here >= 0xdc00 && here <= 0xdfff);
}

/**
 * The Knuth-Morris-Pratt table of a sequence: for each length k, how long the longest proper prefix that is also a
 * suffix of the first k items is. `same` says whether two items are equal.
 */
function failureTable<T>(items: readonly T[], same: (a: T, b: T) => boolean): Int32Array {
  const table = new Int32Array(items.length);
  let k = 0;
  for (let i = 1; i < items.length; i++) {
    while (k > 0 && !same(items[i] as T, items[k] as T)) k = table[k - 1] as number;
    if (same(items[i] as T, items[k] as T)) k += 1;
    table[i] = k;
  }
  return table;
}

/** A part of a segment pattern between two stars: literal UTF-16 units and ANY_CHARACTER. */
interface CharacterPart {
  codes: number[];
  /** How many codes at the start are plain characters (no `?`): all of them when the part holds no `?`. */
  lead: number;
  /** The search table of those plain leading codes, so the part's places can be found in one pass. */
  table: Int32Array;
}

/** One segment of a pattern, cut at its stars. */
interface SegmentPattern {
  /** One part when the segment holds no star; with k stars, k + 1 parts, of which the first and last may be empty. */
  parts: CharacterPart[];
  /** The segment as plain text when it holds no star and no `?`, so a name is simply compared with it; null otherwise. */
  plain: string | null;
}

function sameUnit(a: number, b: number): boolean {
  return a === b;
}

function segmentPattern(codes: readonly number[]): SegmentPattern {
  const parts: CharacterPart[] = [];
  let current: number[] = [];
  const close = (): void => {
    const question = current.indexOf(ANY_CHARACTER);
    const lead = question < 0 ? current.length : question;
    parts.push({ codes: current, lead, table: failureTable(current.slice(0, lead), sameUnit) });
    current = [];
  };
  for (const code of codes) {
    if (code === ANY_RUN) close();
    else current.push(code);
  }
  close();
  const only = parts[0] as CharacterPart;
  const plain = parts.length === 1 && only.lead === only.codes.length ? String.fromCharCode(...only.codes) : null;
  return { parts, plain };
}

/** Where `part`, from its code `skip` on, ends when it is laid at `at`, or MISMATCH, or RAN_OUT. */
function partAt(part: CharacterPart, text: string, at: number, work: CodeownersWork, skip = 0): number {
  const codes = part.codes;
  let t = at;
  work.used += 1;
  for (let p = skip; p < codes.length; p++) {
    work.used += 1;
    if (t >= text.length) return RAN_OUT;
    const code = codes[p] as number;
    if (code === ANY_CHARACTER) t += unitsAt(text, t);
    else if (code === text.charCodeAt(t)) t += 1;
    else return MISMATCH;
  }
  return t;
}

/**
 * Lays `part` at each place at or after `from` where it could start, a star having begun at `from`, in order, and hands
 * `settle` where it ends there (or MISMATCH, or RAN_OUT). `settle` returns true to stop. The places are found with the
 * part's plain leading characters in one Knuth-Morris-Pratt pass, so only the rest of the part (from its first `?` on)
 * is tried place by place; a part that starts with `?` is tried at every character. Every step is added to `work`.
 */
function eachPlace(
  part: CharacterPart,
  text: string,
  from: number,
  work: CodeownersWork,
  settle: (end: number) => boolean,
): void {
  const codes = part.codes;
  const lead = part.lead;
  if (lead === 0) {
    let at = from;
    for (;;) {
      const end = partAt(part, text, at, work);
      if (settle(end) || end === RAN_OUT) return;
      at += unitsAt(text, at);
    }
  }
  const table = part.table;
  let k = 0;
  for (let t = from; t < text.length; t++) {
    const unit = text.charCodeAt(t);
    while (k > 0 && codes[k] !== unit) {
      k = table[k - 1] as number;
      work.used += 1;
    }
    work.used += 1;
    if (codes[k] === unit) k += 1;
    if (k === lead) {
      if (startsCharacter(text, from, t + 1 - lead)) {
        const end = lead === codes.length ? t + 1 : partAt(part, text, t + 1, work, lead);
        if (settle(end) || end === RAN_OUT) return;
      }
      k = table[k - 1] as number;
    }
  }
  // Every later place runs out of text within the plain leading characters.
  settle(RAN_OUT);
}

/** Where the first place `part` fits at or after `from` ends, a star having begun at `from`, or -1. */
function findPart(part: CharacterPart, text: string, from: number, work: CodeownersWork): number {
  if (part.codes.length === 0) return from;
  let found = -1;
  eachPlace(part, text, from, work, (end) => {
    if (end >= 0) found = end;
    return end >= 0;
  });
  return found;
}

/** Whether `part` can end the text, a star having begun at `from`. */
function partEnds(part: CharacterPart, text: string, from: number, work: CodeownersWork): boolean {
  const codes = part.codes;
  if (codes.length === 0) return true;
  if (part.lead === codes.length) {
    // Only one place can end the text: the part's own length before the end.
    const at = text.length - codes.length;
    if (at < from || !startsCharacter(text, from, at)) return false;
    return partAt(part, text, at, work) === text.length;
  }
  let ends = false;
  eachPlace(part, text, from, work, (end) => {
    ends = end === text.length;
    return ends;
  });
  return ends;
}

function matchSegment(pattern: SegmentPattern, text: string, work: CodeownersWork): boolean {
  const parts = pattern.parts;
  const first = parts[0] as CharacterPart;
  if (parts.length === 1) return partAt(first, text, 0, work) === text.length;
  let at = partAt(first, text, 0, work);
  if (at < 0) return false;
  for (let i = 1; i < parts.length - 1; i++) {
    at = findPart(parts[i] as CharacterPart, text, at, work);
    if (at < 0) return false;
  }
  return partEnds(parts[parts.length - 1] as CharacterPart, text, at, work);
}

// ---------------------------------------------------------------------------------------------------------------------
// A compiled pattern is a list of tokens matched against the path's segments from left to right:
//   star  any number of whole segments, none included
//   one   exactly one segment that is not empty (a segment that is exactly `*`)
//   any   exactly one segment, whatever it is (what `/**` or a trailing slash needs below the directory)
//   seg   exactly one segment that matches the pattern's characters
// ---------------------------------------------------------------------------------------------------------------------

type Token = { kind: 'star' } | { kind: 'one' } | { kind: 'any' } | { kind: 'seg'; pattern: SegmentPattern };

const STAR_TOKEN: Token = { kind: 'star' };
const ONE_TOKEN: Token = { kind: 'one' };
const ANY_TOKEN: Token = { kind: 'any' };

/** A part of a compiled pattern between two `star` tokens. */
interface TokenPart {
  tokens: Token[];
  /** The plain names the part starts with (all of its tokens when each is a plain name), and their search table. */
  names: string[];
  table: Int32Array;
}

/** A compiled pattern, cut at its `star` tokens: one part with no star, k + 1 parts with k (the first and last may be empty). */
interface CompiledPattern {
  parts: TokenPart[];
}

function sameName(a: string, b: string): boolean {
  return a === b;
}

function compiledPattern(tokens: readonly Token[]): CompiledPattern {
  const parts: TokenPart[] = [];
  let current: Token[] = [];
  const close = (): void => {
    const names: string[] = [];
    for (const token of current) {
      if (token.kind !== 'seg' || token.pattern.plain === null) break;
      names.push(token.pattern.plain);
    }
    parts.push({ tokens: current, names, table: failureTable(names, sameName) });
    current = [];
  };
  for (const token of tokens) {
    if (token.kind === 'star') close();
    else current.push(token);
  }
  close();
  return { parts };
}

function matchesOne(token: Token, segment: string, work: CodeownersWork): boolean {
  if (token.kind === 'any') return true;
  if (token.kind === 'one') return segment.length > 0;
  if (token.kind === 'seg') {
    const plain = token.pattern.plain;
    return plain !== null ? plain === segment : matchSegment(token.pattern, segment, work);
  }
  return false;
}

/** Where `part`, from its token `skip` on, ends when it is laid at segment `at`, or MISMATCH, or RAN_OUT. */
function tokensAt(part: TokenPart, segments: readonly string[], at: number, work: CodeownersWork, skip = 0): number {
  const tokens = part.tokens;
  let s = at;
  work.used += 1;
  for (let t = skip; t < tokens.length; t++) {
    work.used += 1;
    if (s >= segments.length) return RAN_OUT;
    if (!matchesOne(tokens[t] as Token, segments[s] as string, work)) return MISMATCH;
    s += 1;
  }
  return s;
}

/**
 * Where the first place `part` fits at or after segment `from` ends, or -1. The places where its plain leading names
 * fit are found in one Knuth-Morris-Pratt pass, and only the rest of the part is tried at each of them; a part that does
 * not start with a plain name is tried at every segment. The search stops where the segments run out.
 */
function findTokens(part: TokenPart, segments: readonly string[], from: number, work: CodeownersWork): number {
  const tokens = part.tokens;
  const names = part.names;
  const lead = names.length;
  if (tokens.length === 0) return from;
  if (lead === 0) {
    for (let at = from; ; at++) {
      const end = tokensAt(part, segments, at, work);
      if (end >= 0) return end;
      if (end === RAN_OUT) return -1;
    }
  }
  const table = part.table;
  let k = 0;
  for (let s = from; s < segments.length; s++) {
    const segment = segments[s] as string;
    while (k > 0 && names[k] !== segment) {
      k = table[k - 1] as number;
      work.used += 1;
    }
    work.used += 1;
    if (names[k] === segment) k += 1;
    if (k === lead) {
      const end = lead === tokens.length ? s + 1 : tokensAt(part, segments, s + 1, work, lead);
      if (end >= 0) return end;
      if (end === RAN_OUT) return -1;
      k = table[k - 1] as number;
    }
  }
  return -1;
}

/**
 * Whether `part` can end the segments, a `star` having begun at segment `from`. Every token stands for exactly one
 * segment, so only one place can end the path: the part's own length before the end.
 */
function tokensEnd(part: TokenPart, segments: readonly string[], from: number, work: CodeownersWork): boolean {
  const length = part.tokens.length;
  if (length === 0) return true;
  const at = segments.length - length;
  return at >= from && tokensAt(part, segments, at, work) === segments.length;
}

/**
 * Matches a compiled pattern against the segments. The part before the first `star` must start the path, the part after
 * the last must end it, and each part in between is taken at the first place it fits, left to right: the same answer the
 * usual two-pointer walk for wildcards gives, since that walk only ever moves its last star. A part's places are found
 * from its plain leading names in one pass; only a part with a wildcard name, a `one` or an `any` token in it is then
 * tried place by place, so such a part can cost its length times the segments. Every step is added to `work`.
 */
function matchTokens(pattern: CompiledPattern, segments: readonly string[], work: CodeownersWork): boolean {
  const parts = pattern.parts;
  const first = parts[0] as TokenPart;
  if (parts.length === 1) return tokensAt(first, segments, 0, work) === segments.length;
  let at = tokensAt(first, segments, 0, work);
  if (at < 0) return false;
  for (let i = 1; i < parts.length - 1; i++) {
    at = findTokens(parts[i] as TokenPart, segments, at, work);
    if (at < 0) return false;
  }
  return tokensEnd(parts[parts.length - 1] as TokenPart, segments, at, work);
}

/** One segment of a pattern as codes: literal UTF-16 units, ANY_CHARACTER and ANY_RUN. Marks what GitHub does not document. */
function compileSegment(segment: string, marks: Set<string>): number[] {
  const codes: number[] = [];
  let i = 0;
  while (i < segment.length) {
    const code = segment.charCodeAt(i);
    if (code === BACKSLASH) {
      if (i + 1 < segment.length) {
        // A backslash takes the next character as it is. GitHub documents only the escaped leading # (which does not work).
        marks.add('a backslash escape');
        codes.push(segment.charCodeAt(i + 1));
        i += 2;
      } else {
        // A backslash at the very end has nothing to escape and stands for itself.
        codes.push(BACKSLASH);
        i += 1;
      }
    } else if (code === STAR) {
      if (codes[codes.length - 1] !== ANY_RUN) codes.push(ANY_RUN);
      i += 1;
    } else if (code === 63) {
      marks.add('?');
      codes.push(ANY_CHARACTER);
      i += 1;
    } else {
      codes.push(code);
      i += 1;
    }
  }
  return codes;
}

/**
 * Compiles one pattern. Returns null for a pattern that can match no file. The reading is the one GitHub's page gives by
 * example and by saying CODEOWNERS follows gitignore's pattern rules:
 *  - a pattern with one segment (`foo`, `foo/`, `*.js`) matches that name at any depth, and everything under it;
 *  - a leading slash anchors at the top of the repository, and so does a slash in the middle (`docs/x`);
 *  - a trailing slash means everything below that directory;
 *  - a last segment that is exactly `*` matches direct children only (`docs/*` owns `docs/a.md`, not `docs/x/b.md`),
 *    while any other last segment also matches everything under it;
 *  - `**` at the start matches any directories, at the end everything below, and in the middle zero or more directories.
 * GitHub documents none of the following, so each is this page's reading and the note says so: a run of slashes at the
 * start or the end is read as one slash; a run of slashes in the middle leaves an empty name that no real path has, so the
 * pattern matches nothing; a run of `**` segments is read as one; a pattern that is only `**` matches every path; and
 * a double star with a trailing slash and nothing else matches every file inside some directory.
 */
function compilePattern(pattern: string, marks: Set<string>): CompiledPattern | null {
  const raw = pattern.split('/');
  let from = 0;
  while (from < raw.length && raw[from] === '') from += 1;
  if (from === raw.length) return null;
  let to = raw.length;
  while (raw[to - 1] === '') to -= 1;
  const anchored = from > 0;
  const trailingSlash = to < raw.length;
  // Only the names between the outer slashes are left; an empty one among them is a run of slashes in the middle, and
  // a run of `**` names is read as one.
  const core: string[] = [];
  let runs = (from > 1 ? 1 : 0) + (raw.length - to > 1 ? 1 : 0);
  for (const part of raw.slice(from, to)) {
    if (part === '') runs += 1;
    if (part === '**' && core[core.length - 1] === '**') runs += 1;
    else core.push(part);
  }
  if (runs > 0) marks.add('runs of ** or /');
  if (core.length === 1 && core[0] === '**' && trailingSlash) {
    marks.add('a bare **');
    return compiledPattern([ANY_TOKEN, ANY_TOKEN, STAR_TOKEN]);
  }

  const flat: string[] = [];
  if (!anchored && core.length === 1 && core[0] !== '**') flat.push('**');
  for (const part of core) flat.push(part);
  if (trailingSlash && core[core.length - 1] !== '**') flat.push('**');

  const tokens: Token[] = [];
  const push = (token: Token): void => {
    if (token.kind === 'star' && tokens[tokens.length - 1]?.kind === 'star') return;
    tokens.push(token);
  };
  const last = flat.length - 1;
  for (let i = 0; i < flat.length; i++) {
    const part = flat[i] as string;
    if (part === '**') {
      if (flat.length === 1) {
        marks.add('a bare **');
        push(ANY_TOKEN);
        push(STAR_TOKEN);
      } else if (i === last) {
        push(ANY_TOKEN);
        push(STAR_TOKEN);
      } else {
        push(STAR_TOKEN);
      }
    } else if (part === '*') {
      push(ONE_TOKEN);
    } else {
      push({ kind: 'seg', pattern: segmentPattern(compileSegment(part, marks)) });
      // Any other last segment also owns everything under a directory of that name.
      if (i === last) push(STAR_TOKEN);
    }
  }
  return compiledPattern(tokens);
}

function hasStarRun(text: string): boolean {
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    run = text.charCodeAt(i) === STAR ? run + 1 : 0;
    if (run >= 3) return true;
  }
  return false;
}

function isOnlySlashes(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 47) return false;
  }
  return true;
}

/**
 * The reason a pattern is unsupported, or null. GitHub's page says the first three do not work; the last two are this
 * page's reading. A pattern of only slashes names no file, so it would match nothing and decide no row, and its line
 * would never be seen labelled: it is listed instead.
 */
function unsupportedReason(pattern: string): { reason: string; documented: boolean } | null {
  if (pattern.charCodeAt(0) === 33) {
    return { reason: 'a leading ! to negate a pattern does not work in CODEOWNERS files', documented: true };
  }
  if (pattern.charCodeAt(0) === BACKSLASH && pattern.charCodeAt(1) === HASH) {
    return { reason: 'escaping a leading # with a backslash does not work in CODEOWNERS files', documented: true };
  }
  if (pattern.includes('[') || pattern.includes(']')) {
    return { reason: 'a [ ] character range does not work in CODEOWNERS files', documented: true };
  }
  if (hasStarRun(pattern)) {
    return { reason: 'three or more stars in a row', documented: false };
  }
  if (isOnlySlashes(pattern)) {
    return { reason: 'a pattern of only slashes names no file', documented: false };
  }
  return null;
}

/** The tokens of a line: split at spaces and tabs, a backslash taking the next character with it. */
function splitTokens(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && isSeparator(line.charCodeAt(i))) i += 1;
    if (i >= line.length) break;
    const start = i;
    while (i < line.length && !isSeparator(line.charCodeAt(i))) {
      i += line.charCodeAt(i) === BACKSLASH && i + 1 < line.length ? 2 : 1;
    }
    tokens.push(line.slice(start, i));
  }
  return tokens;
}

/** A line that is blank, or whose first non-space character is `#`. */
function isIgnorable(line: string): boolean {
  if (isBlank(line)) return true;
  let i = 0;
  while (i < line.length && isSeparator(line.charCodeAt(i))) i += 1;
  return line.charCodeAt(i) === HASH;
}

/**
 * Reads a CODEOWNERS file. Every line is read once. Comment lines and blank lines are skipped; after the pattern, an
 * owner that starts with `#` ends the line (the inline comment of GitHub's example). A line that GitHub does not support
 * is listed in `skipped` and matches nothing. Line numbers count every pasted line.
 */
export function parseCodeowners(text: string): { rules: CodeownersRule[]; skipped: SkippedLine[] } {
  const rules: CodeownersRule[] = [];
  const skipped: SkippedLine[] = [];
  forEachLine(text, (lineText, line) => {
    if (isIgnorable(lineText)) return;
    const tokens = splitTokens(lineText);
    const pattern = tokens[0] as string;
    const unsupported = unsupportedReason(pattern);
    if (unsupported) {
      skipped.push({ line, shown: visible(pattern, MAX_SHOWN_PATTERN), ...unsupported });
      return;
    }
    const owners: string[] = [];
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i] as string;
      if (token.charCodeAt(0) === HASH) break;
      owners.push(token);
    }
    // One owner that is none of the three forms makes the whole line unreadable, and GitHub skips a line it cannot read.
    if (!owners.every(isOwner)) {
      skipped.push({
        line,
        shown: visible(pattern, MAX_SHOWN_PATTERN),
        reason: 'an owner is not @username, @org/team-name or an email address',
        documented: false,
      });
      return;
    }
    const marks = new Set<string>();
    const compiled = compilePattern(pattern, marks);
    rules.push({
      line,
      pattern,
      owners,
      note: marks.size === 0 ? '' : `${NOT_DOCUMENTED}: ${[...marks].join(', ')}`,
      matches: (path) => compiled !== null && matchTokens(compiled, path.split('/'), { used: 0 }),
      matchesSegments: (segments, work = { used: 0 }) => compiled !== null && matchTokens(compiled, segments, work),
    });
  });
  return { rules, skipped };
}

function refusePath(line: number, problem: string): GlobTesterError {
  return new GlobTesterError(`Line ${line} of the paths ${problem}`, 'paths', line);
}

/** One path line, checked by the rules every mode shares, and refused when it names a directory (it ends in a slash). */
function checkCodeownersPath(text: string, line: number): string {
  const { path, isDirectory } = checkPath(text, line);
  if (isDirectory) throw refusePath(line, 'ends with /. In CODEOWNERS mode every path names a file, so remove the /.');
  return path;
}

/** The refusal of a paste that needs more matching work than MAX_CODEOWNERS_WORK. It names the path line, never text. */
function tooMuchWork(line: number): GlobTesterError {
  return new GlobTesterError(
    `Matching stopped at line ${line} of the paths: this CODEOWNERS file and these paths need more matching work than this page allows (${withCommas(MAX_CODEOWNERS_WORK)} steps). Try fewer paths or fewer rules.`,
    'paths',
    line,
  );
}

/**
 * The deciding rule for each pasted path: the rules are scanned from the last line to the first and the first that matches
 * decides, so the owners of earlier lines are never merged. A path no line matches has no owner and no deciding line. Rows
 * keep the pasted order, and a path pasted twice gives two rows. The work of the whole paste is counted, and once it
 * passes MAX_CODEOWNERS_WORK the paste is refused, naming the path line where matching stopped.
 */
export function ownersForPaths(rules: readonly CodeownersRule[], pathsText: string): CodeownersRow[] {
  const rows: CodeownersRow[] = [];
  const work: CodeownersWork = { used: 0 };
  forEachLine(pathsText, (text, number) => {
    if (isBlank(text)) return;
    const path = checkCodeownersPath(text, number);
    const segments = path.split('/');
    let decided: CodeownersRule | null = null;
    for (let k = rules.length - 1; k >= 0; k--) {
      const rule = rules[k] as CodeownersRule;
      work.used += 1;
      const matched = rule.matchesSegments(segments, work);
      if (work.used > MAX_CODEOWNERS_WORK) throw tooMuchWork(number);
      if (matched) {
        decided = rule;
        break;
      }
    }
    rows.push(
      decided === null
        ? { path, owners: [], line: null, pattern: '', note: '' }
        : { path, owners: [...decided.owners], line: decided.line, pattern: decided.pattern, note: decided.note },
    );
  });
  return rows;
}

/** Reads the file, then answers every path. The size of the paste is `checkCodeownersInput`'s to judge, before this. */
export function codeownersRows(text: string, pathsText: string): { rows: CodeownersRow[]; skipped: SkippedLine[] } {
  const { rules, skipped } = parseCodeowners(text);
  return { rows: ownersForPaths(rules, pathsText), skipped };
}

/**
 * Refuses a paste that is too big, before anything is parsed or matched. A refusal names the limit and, for a line, its
 * number; it never holds any of the pasted text. GitHub itself does not load a CODEOWNERS file of 3 MB or more.
 */
export function checkCodeownersInput(text: string, pathsText: string): void {
  if (text.length > MAX_CODEOWNERS_CHARACTERS) {
    throw new GlobTesterError(
      `This CODEOWNERS paste is ${withCommas(text.length)} characters. The limit here is ${withCommas(MAX_CODEOWNERS_CHARACTERS)}; GitHub does not load a CODEOWNERS file of 3 MB or more.`,
      'patterns',
    );
  }
  if (pathsText.length > MAX_PATH_PASTE_CHARACTERS) {
    throw new GlobTesterError(
      `This paste is ${withCommas(pathsText.length)} characters. The limit is ${withCommas(MAX_PATH_PASTE_CHARACTERS)} because that is the most that ${withCommas(MAX_PATH_LINES)} paths of up to ${withCommas(MAX_PATH_CHARACTERS)} characters can fill.`,
      'paths',
    );
  }
  let rules = 0;
  forEachLine(text, (line, number) => {
    // A comment line or a blank line is skipped, as GitHub skips it, so only the size of the paste limits it.
    if (isIgnorable(line)) return;
    if (line.length > MAX_CODEOWNERS_LINE_CHARACTERS) {
      throw new GlobTesterError(
        `Line ${number} of the CODEOWNERS file is longer than ${withCommas(MAX_CODEOWNERS_LINE_CHARACTERS)} characters.`,
        'patterns',
        number,
      );
    }
    rules += 1;
    if (rules > MAX_CODEOWNERS_RULES) {
      throw new GlobTesterError(
        `There are more than ${withCommas(MAX_CODEOWNERS_RULES)} rules (blank lines and comments do not count). Line ${number} is the first one past the limit of ${withCommas(MAX_CODEOWNERS_RULES)}.`,
        'patterns',
        number,
      );
    }
  });
  let paths = 0;
  forEachLine(pathsText, (line, number) => {
    if (line.length > MAX_PATH_CHARACTERS) {
      throw refusePath(number, `is longer than ${withCommas(MAX_PATH_CHARACTERS)} characters.`);
    }
    if (isBlank(line)) return;
    paths += 1;
    if (paths > MAX_PATH_LINES) {
      throw new GlobTesterError(
        `There are more than ${withCommas(MAX_PATH_LINES)} paths (blank lines do not count). Line ${number} is the first one past the limit of ${withCommas(MAX_PATH_LINES)}.`,
        'paths',
        number,
      );
    }
    checkCodeownersPath(line, number);
  });
}
