/**
 * Test, replace and explain JavaScript regular expressions.
 *
 * Pure logic only: no DOM, no network, no storage, no timers, no background
 * thread of any kind. A JavaScript regex match is synchronous and cannot be
 * interrupted from inside once started (RegExp.prototype.exec runs the
 * engine's native matcher to completion, or forever, with no yield point a
 * script could use to check an elapsed-time flag). Because of that, this
 * package never times out on its own -- the page composes a time limit
 * around it by running the match off this thread and terminating it from
 * the outside, which is why no timer or DOM reference appears anywhere in
 * this file.
 */
import meta from './meta.json';

export { meta };

/** Matches beyond this many are still counted in `total`, but not listed in `matches`. */
export const MAX_MATCHES = 1000;

/**
 * The v and d flags are deliberately not offered: v changes character class
 * set semantics this tool does not parse, and d only adds match indices
 * this tool does not surface. Both are valid native RegExp flags, so an
 * engine would accept them silently -- they are rejected here by name
 * instead.
 */
export const SUPPORTED_FLAGS = ['g', 'i', 'm', 's', 'u', 'y'] as const;
export type SupportedFlag = (typeof SUPPORTED_FLAGS)[number];

export type RegexMode = 'test' | 'replace' | 'explain';

export interface RegexJob {
  mode: RegexMode;
  pattern: string;
  flags: string;
  input: string;
  /** Only read in replace mode. */
  replacement?: string;
}

export interface MatchGroup {
  /** The group's own name if it was declared with (?<name>...), otherwise its 1-based position as text. */
  name: string;
  /** undefined when this group did not participate in the match, e.g. an unmatched alternative. */
  value: string | undefined;
}

export interface MatchRow {
  index: number;
  text: string;
  groups: MatchGroup[];
}

export interface RegexTestResult {
  mode: 'test';
  matches: MatchRow[];
  total: number;
  truncated: boolean;
}

export interface RegexReplaceResult {
  mode: 'replace';
  output: string;
  count: number;
}

export interface ExplainPart {
  /** Nesting level, for indented rendering. 0 is top level. */
  depth: number;
  /** The exact substring of the pattern this part covers. */
  source: string;
  description: string;
}

export interface RegexExplainResult {
  mode: 'explain';
  parts: ExplainPart[];
}

export type RegexResult = RegexTestResult | RegexReplaceResult | RegexExplainResult;

export class RegexToolError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'RegexToolError';
    this.position = position;
  }
}

function validateFlags(flags: string): void {
  const seen = new Set<string>();
  for (const ch of flags) {
    if (!(SUPPORTED_FLAGS as readonly string[]).includes(ch)) {
      throw new RegexToolError(`"${ch}" is not a supported flag. Supported flags are ${SUPPORTED_FLAGS.join(', ')}.`);
    }
    if (seen.has(ch)) {
      throw new RegexToolError(`The flag "${ch}" is repeated. Each flag may be used at most once.`);
    }
    seen.add(ch);
  }
}

function compile(pattern: string, flags: string): RegExp {
  validateFlags(flags);
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    throw new RegexToolError(err instanceof Error ? err.message : 'This pattern could not be compiled.');
  }
}

/**
 * Walks the pattern's own source once to record, for each capturing group in
 * the order it appears, whether it was declared with a name -- (?<name>...)
 * -- so a match's numbered captures can be labelled with their real name
 * instead of duplicating a value under both its number and its name.
 * Non-capturing groups (?:...), lookahead (?=...) / (?!...) and lookbehind
 * (?<=...) / (?<!...) are skipped, matching what the engine itself does not
 * count as a capturing group. Character classes are tracked separately so a
 * literal "(" inside [...] is never mistaken for a group.
 */
function capturingGroupIsNamed(pattern: string): boolean[] {
  const flags: boolean[] = [];
  let i = 0;
  let inClass = false;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      i++;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      i++;
      continue;
    }
    if (ch === '(') {
      if (pattern[i + 1] === '?') {
        if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') {
          flags.push(true);
          i += 3;
          continue;
        }
        // (?:  (?=  (?!  (?<=  (?<!  -- none of these capture.
        i += 1;
        continue;
      }
      flags.push(false);
      i++;
      continue;
    }
    i++;
  }
  return flags;
}

function groupsFromMatch(match: RegExpExecArray, isNamed: boolean[]): MatchGroup[] {
  const namedKeys = match.groups ? Object.keys(match.groups) : [];
  let namedIndex = 0;
  const groups: MatchGroup[] = [];
  for (let i = 1; i < match.length; i++) {
    const named = isNamed[i - 1] === true;
    const name = named ? namedKeys[namedIndex++]! : String(i);
    groups.push({ name, value: match[i] });
  }
  return groups;
}

export function testPattern(pattern: string, flags: string, input: string): RegexTestResult {
  const re = compile(pattern, flags);
  const isNamed = capturingGroupIsNamed(pattern);
  const matches: MatchRow[] = [];
  let total = 0;

  if (flags.includes('g')) {
    for (const match of input.matchAll(re)) {
      total++;
      if (matches.length < MAX_MATCHES) {
        matches.push({ index: match.index!, text: match[0], groups: groupsFromMatch(match, isNamed) });
      }
    }
  } else {
    const match = re.exec(input);
    if (match) {
      total = 1;
      matches.push({ index: match.index, text: match[0], groups: groupsFromMatch(match, isNamed) });
    }
  }

  return { mode: 'test', matches, total, truncated: total > matches.length };
}

/**
 * Replaces every match (or, without the global flag, only the first) using
 * the engine's own ECMA-262 GetSubstitution semantics for the replacement
 * string -- $$, $&, $`, $', $n/$nn and $<name> are the engine's, not
 * hand-rolled here, which is deliberately unlike this project's literal
 * find-and-replace tool: there, a replacement string is escaped so a
 * dollar sequence is never expanded; here, that expansion is the feature.
 * Two fresh compiles of the same pattern and flags: one purely to count
 * matches (matchAll requires the global flag; exec does not carry the same
 * lastIndex state a second, independent call would need to reset), the
 * other handed straight to String.prototype.replace so its own built-in
 * substitution logic runs unmodified.
 */
export function replacePattern(pattern: string, flags: string, input: string, replacement: string): RegexReplaceResult {
  const counter = compile(pattern, flags);
  let count = 0;
  if (flags.includes('g')) {
    for (const _match of input.matchAll(counter)) count++;
  } else if (counter.exec(input)) {
    count = 1;
  }

  const output = input.replace(compile(pattern, flags), replacement);
  return { mode: 'replace', output, count };
}

export function explainPattern(_pattern: string, _flags: string): RegexExplainResult {
  throw new RegexToolError('Explain mode is not available yet.');
}

export function runRegexJob(job: RegexJob): RegexResult {
  switch (job.mode) {
    case 'test':
      return testPattern(job.pattern, job.flags, job.input);
    case 'replace':
      return replacePattern(job.pattern, job.flags, job.input, job.replacement ?? '');
    case 'explain':
      return explainPattern(job.pattern, job.flags);
    default: {
      const exhaustive: never = job.mode;
      throw new RegexToolError(`Unknown mode: ${String(exhaustive)}`);
    }
  }
}
