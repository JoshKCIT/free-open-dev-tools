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
import { RegExpParser, type AST } from '@eslint-community/regexpp';
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

function describeQuantifier(node: AST.Quantifier): string {
  const greedy = node.greedy ? 'greedy' : 'lazy (as few as possible)';
  if (node.min === 0 && node.max === Infinity) return `${greedy}, zero or more times`;
  if (node.min === 1 && node.max === Infinity) return `${greedy}, one or more times`;
  if (node.min === 0 && node.max === 1) return `${greedy}, zero or one time (optional)`;
  if (node.min === node.max) return `exactly ${node.min} time${node.min === 1 ? '' : 's'}`;
  if (node.max === Infinity) return `${greedy}, ${node.min} or more times`;
  return `${greedy}, between ${node.min} and ${node.max} times`;
}

function describeCharacterSet(node: AST.CharacterSet): string {
  switch (node.kind) {
    case 'any':
      return 'any character except a line terminator (or truly any character when the s flag is set)';
    case 'digit':
      return node.negate ? 'any character that is not a digit (0-9)' : 'a digit (0-9)';
    case 'space':
      return node.negate ? 'any character that is not whitespace' : 'a whitespace character';
    case 'word':
      return node.negate
        ? 'any character that is not a word character (letter, digit or underscore)'
        : 'a word character (letter, digit or underscore)';
    case 'property': {
      const property = node.value ? `${node.key}=${node.value}` : node.key;
      return `${node.negate ? 'any character NOT matching' : 'a character matching'} the Unicode property ${property}`;
    }
  }
}

function describeBackreference(node: AST.Backreference): string {
  return typeof node.ref === 'number'
    ? `the same text already matched by group ${node.ref}`
    : `the same text already matched by the group named "${node.ref}"`;
}

/** One entry per element of a character class: a literal character, a range, or a nested character set. */
function describeCharacterClassElement(el: AST.ClassRangesCharacterClassElement): string {
  if (el.type === 'Character') return `"${String.fromCodePoint(el.value)}"`;
  if (el.type === 'CharacterClassRange') {
    return `${String.fromCodePoint(el.min.value)} through ${String.fromCodePoint(el.max.value)}`;
  }
  return describeCharacterSet(el);
}

function describeCharacterClass(node: AST.ClassRangesCharacterClass): string {
  const items = node.elements.map(describeCharacterClassElement);
  const body = items.length > 0 ? items.join(', ') : 'nothing (an empty character class never matches)';
  return node.negate ? `any character NOT one of: ${body}` : `one of: ${body}`;
}

function describeAssertionOpen(node: AST.Assertion): string {
  switch (node.kind) {
    case 'start':
      return 'start of the string (or, with the m flag, start of a line)';
    case 'end':
      return 'end of the string (or, with the m flag, end of a line)';
    case 'word':
      return node.negate
        ? 'not a word boundary'
        : 'a word boundary (between a word character and a non-word character, or a string edge)';
    case 'lookahead':
      return node.negate
        ? 'negative lookahead: the following is NOT matched next, without consuming it'
        : 'lookahead: the following IS matched next, without consuming it';
    case 'lookbehind':
      return node.negate
        ? 'negative lookbehind: the following is NOT matched immediately before this point, without consuming it'
        : 'lookbehind: the following IS matched immediately before this point, without consuming it';
  }
}

function walkAlternatives(alternatives: AST.Alternative[], depth: number, parts: ExplainPart[]): void {
  if (alternatives.length === 1) {
    walkElements(alternatives[0]!.elements, depth, parts);
    return;
  }
  alternatives.forEach((alt, i) => {
    parts.push({
      depth,
      source: alt.raw,
      description: `alternative ${i + 1} of ${alternatives.length}, separated by |`,
    });
    walkElements(alt.elements, depth + 1, parts);
  });
}

function walkElements(elements: AST.Element[], depth: number, parts: ExplainPart[]): void {
  for (const el of elements) walkElement(el, depth, parts);
}

function walkElement(node: AST.Element, depth: number, parts: ExplainPart[]): void {
  if (node.type === 'Quantifier') {
    parts.push({ depth, source: node.raw, description: describeQuantifier(node) });
    walkElement(node.element, depth + 1, parts);
    return;
  }
  if (node.type === 'Assertion') {
    parts.push({ depth, source: node.raw, description: describeAssertionOpen(node) });
    if (node.kind === 'lookahead' || node.kind === 'lookbehind') {
      walkAlternatives(node.alternatives, depth + 1, parts);
    }
    return;
  }
  walkAtom(node, depth, parts);
}

/** QuantifiableElement minus the two node types already routed to walkElement above (Quantifier and LookaheadAssertion). */
function walkAtom(
  node: Exclude<AST.QuantifiableElement, AST.Quantifier | AST.LookaheadAssertion>,
  depth: number,
  parts: ExplainPart[],
): void {
  switch (node.type) {
    case 'CapturingGroup':
      parts.push({
        depth,
        source: node.raw,
        description: node.name ? `a named capturing group called "${node.name}"` : 'a capturing group',
      });
      walkAlternatives(node.alternatives, depth + 1, parts);
      return;
    case 'Group':
      parts.push({ depth, source: node.raw, description: 'a non-capturing group' });
      walkAlternatives(node.alternatives, depth + 1, parts);
      return;
    case 'Character':
      parts.push({
        depth,
        source: node.raw,
        description: `the literal character "${String.fromCodePoint(node.value)}"`,
      });
      return;
    case 'CharacterClass':
      parts.push({
        depth,
        source: node.raw,
        description: node.unicodeSets
          ? 'a Unicode-set-mode character class (v flag) -- not offered by this tool since the v flag is not supported'
          : describeCharacterClass(node),
      });
      return;
    case 'CharacterSet':
      parts.push({ depth, source: node.raw, description: describeCharacterSet(node) });
      return;
    case 'Backreference':
      parts.push({ depth, source: node.raw, description: describeBackreference(node) });
      return;
    case 'ExpressionCharacterClass':
      parts.push({
        depth,
        source: node.raw,
        description:
          'a character class set expression (v flag) -- not offered by this tool since the v flag is not supported',
      });
      return;
  }
}

/**
 * Parses with @eslint-community/regexpp (the same parser ESLint's own regex
 * rules use, already a transitive devDependency of this repository) and
 * walks the AST into a flat, depth-annotated part list -- depth is what
 * lets the page indent a quantifier's own quantified element, or a group's
 * own contents, beneath it. The engine's own `new RegExp` runs first
 * (through the same `compile` every other mode uses) purely so an invalid
 * pattern or unsupported flag is rejected with the identical message
 * testPattern and replacePattern already give; regexpp's own parse should
 * then always succeed, since it targets the same ECMA-262 grammar the
 * engine just accepted.
 */
export function explainPattern(pattern: string, flags: string): RegexExplainResult {
  compile(pattern, flags);

  let root: AST.Pattern;
  try {
    root = new RegExpParser().parsePattern(pattern, 0, pattern.length, { unicode: flags.includes('u') });
  } catch (err) {
    throw new RegexToolError(err instanceof Error ? err.message : 'This pattern could not be parsed.');
  }

  const parts: ExplainPart[] = [];
  walkAlternatives(root.alternatives, 0, parts);
  return { mode: 'explain', parts };
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
