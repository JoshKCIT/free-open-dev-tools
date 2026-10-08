import { GlobTesterError } from './errors';
import { MAX_PATH_PASTE_CHARACTERS, withCommas } from './limits';
import { checkPath, forEachLine, isBlank } from './lines';
import { MAX_SHOWN_PATTERN, visible } from './visible';

/**
 * CODEOWNERS mode: which owners a CODEOWNERS file gives each pasted path, and which line decided it, following the rules
 * GitHub documents in "About code owners": the last line that matches a path decides, the owners of earlier lines are never
 * merged, a line with no owners leaves its paths with no owner, paths are case sensitive, and a line GitHub cannot read is
 * skipped. Behaviour GitHub does not document (runs of double stars and slashes, a question mark, other backslash
 * escapes, the exact shape of an owner) is this page's reading, and each place it is used is marked.
 *
 * Nothing here builds a regular expression from pasted text. A pattern is compiled to a short list of tokens and matched
 * with a two-pointer walk, once over the path's segments and once over the characters of a segment, so a hostile pattern
 * costs time in proportion to its length and the path's, never an exponential search.
 */

/** The most CODEOWNERS text that is read. GitHub itself does not load a file of 3 MB or more; a paste this size is no longer a quick check. */
export const MAX_CODEOWNERS_CHARACTERS = 600_000;
/** The most rules (lines that are neither blank nor a comment). */
export const MAX_CODEOWNERS_RULES = 5_000;
/** The longest single CODEOWNERS line. */
export const MAX_CODEOWNERS_LINE_CHARACTERS = 4_000;

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
  /** The same question for a path already split at its slashes (what ownersForPaths asks many times over). */
  matchesSegments(segments: readonly string[]): boolean;
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

function isSeparator(code: number): boolean {
  return code === SPACE || code === TAB;
}

// ---------------------------------------------------------------------------------------------------------------------
// Matching one path segment against a segment of the pattern: `*` is any characters, `?` is one character, a backslash
// takes the next character literally. Characters are compared by UTF-16 unit, and `?` and a retrying `*` step over a
// surrogate pair as one character, so half of an emoji is never matched.
// ---------------------------------------------------------------------------------------------------------------------

const ANY_CHARACTER = -1;
const ANY_RUN = -2;

function unitsAt(text: string, index: number): number {
  const high = text.charCodeAt(index);
  if (high >= 0xd800 && high <= 0xdbff && index + 1 < text.length) {
    const low = text.charCodeAt(index + 1);
    if (low >= 0xdc00 && low <= 0xdfff) return 2;
  }
  return 1;
}

function matchSegment(pattern: readonly number[], text: string): boolean {
  let p = 0;
  let t = 0;
  let starAt = -1;
  let starText = 0;
  while (t < text.length) {
    const code = p < pattern.length ? (pattern[p] as number) : 0;
    if (p < pattern.length && code === ANY_RUN) {
      starAt = p;
      starText = t;
      p += 1;
    } else if (p < pattern.length && code === ANY_CHARACTER) {
      t += unitsAt(text, t);
      p += 1;
    } else if (p < pattern.length && code === text.charCodeAt(t)) {
      p += 1;
      t += 1;
    } else if (starAt >= 0) {
      starText += unitsAt(text, starText);
      t = starText;
      p = starAt + 1;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === ANY_RUN) p += 1;
  return p === pattern.length;
}

// ---------------------------------------------------------------------------------------------------------------------
// A compiled pattern is a list of tokens matched against the path's segments from left to right:
//   star  any number of whole segments, none included
//   one   exactly one segment that is not empty (a segment that is exactly `*`)
//   any   exactly one segment, whatever it is (what `/**` or a trailing slash needs below the directory)
//   seg   exactly one segment that matches the pattern's characters
// ---------------------------------------------------------------------------------------------------------------------

type Token = { kind: 'star' } | { kind: 'one' } | { kind: 'any' } | { kind: 'seg'; codes: number[] };

const STAR_TOKEN: Token = { kind: 'star' };
const ONE_TOKEN: Token = { kind: 'one' };
const ANY_TOKEN: Token = { kind: 'any' };

function matchesOne(token: Token, segment: string): boolean {
  if (token.kind === 'any') return true;
  if (token.kind === 'one') return segment.length > 0;
  if (token.kind === 'seg') return matchSegment(token.codes, segment);
  return false;
}

/**
 * Matches the tokens against the segments with the usual two-pointer walk for wildcards: the last `star` remembers where
 * it is, and on a mismatch it takes one more segment and the walk goes on. Each segment is passed over a bounded number of
 * times, so the cost is the tokens times the segments at most, and nothing is ever tried twice from the same place.
 */
function matchTokens(tokens: readonly Token[], segments: readonly string[]): boolean {
  let t = 0;
  let s = 0;
  let starAt = -1;
  let starSegment = 0;
  while (s < segments.length) {
    const token = tokens[t];
    if (token !== undefined && token.kind === 'star') {
      starAt = t;
      starSegment = s;
      t += 1;
    } else if (token !== undefined && matchesOne(token, segments[s] as string)) {
      t += 1;
      s += 1;
    } else if (starAt >= 0) {
      starSegment += 1;
      s = starSegment;
      t = starAt + 1;
    } else {
      return false;
    }
  }
  while (t < tokens.length && (tokens[t] as Token).kind === 'star') t += 1;
  return t === tokens.length;
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
 * Runs of slashes and of `**` segments are read as one (GitHub does not document them, and the note says so), and a
 * pattern that is only `**` matches every path.
 */
function compilePattern(pattern: string, marks: Set<string>): Token[] | null {
  const raw = pattern.split('/');
  const anchored = raw.length > 1 && raw[0] === '';
  const trailingSlash = raw.length > 1 && raw[raw.length - 1] === '';
  const core = raw.filter((part) => part !== '');
  if (core.length === 0) return null;
  // One leading and one trailing slash are the ordinary ones; any more empty parts are a run of slashes.
  let runs = raw.length - core.length - (anchored ? 1 : 0) - (trailingSlash ? 1 : 0);

  const segments: string[] = [];
  if (!anchored && core.length === 1 && core[0] !== '**') segments.push('**');
  for (const part of core) segments.push(part);
  if (trailingSlash) segments.push('**');

  // Runs of `**` read as one.
  const flat: string[] = [];
  for (const part of segments) {
    if (part === '**' && flat[flat.length - 1] === '**') runs += 1;
    else flat.push(part);
  }
  if (runs > 0) marks.add('runs of ** or /');

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
      push({ kind: 'seg', codes: compileSegment(part, marks) });
      // Any other last segment also owns everything under a directory of that name.
      if (i === last) push(STAR_TOKEN);
    }
  }
  return tokens;
}

function hasStarRun(text: string): boolean {
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    run = text.charCodeAt(i) === STAR ? run + 1 : 0;
    if (run >= 3) return true;
  }
  return false;
}

/** The reason a pattern is unsupported, or null. GitHub's page says the first three do not work; the fourth is this page's. */
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
    const marks = new Set<string>();
    const compiled = compilePattern(pattern, marks);
    rules.push({
      line,
      pattern,
      owners,
      note: marks.size === 0 ? '' : `${NOT_DOCUMENTED}: ${[...marks].join(', ')}`,
      matches: (path) => compiled !== null && matchTokens(compiled, path.split('/')),
      matchesSegments: (segments) => compiled !== null && matchTokens(compiled, segments),
    });
  });
  return { rules, skipped };
}

/**
 * The deciding rule for each pasted path: the rules are scanned from the last line to the first and the first that matches
 * decides, so the owners of earlier lines are never merged. A path no line matches has no owner and no deciding line. Rows
 * keep the pasted order, and a path pasted twice gives two rows.
 */
export function ownersForPaths(rules: readonly CodeownersRule[], pathsText: string): CodeownersRow[] {
  const rows: CodeownersRow[] = [];
  forEachLine(pathsText, (text, number) => {
    if (isBlank(text)) return;
    const { path } = checkPath(text, number);
    const segments = path.split('/');
    let decided: CodeownersRule | null = null;
    for (let k = rules.length - 1; k >= 0; k--) {
      const rule = rules[k] as CodeownersRule;
      if (rule.matchesSegments(segments)) {
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
      `This paste is ${withCommas(pathsText.length)} characters. The limit is ${withCommas(MAX_PATH_PASTE_CHARACTERS)}.`,
      'paths',
    );
  }
}
