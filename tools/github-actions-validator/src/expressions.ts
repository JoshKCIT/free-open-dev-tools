/**
 * A hand-written tokenizer and recursive-descent parser for the documented
 * `${{ }}` expression grammar GitHub Actions workflows use, and a scanner
 * that finds every expression span in a workflow's raw YAML source text.
 *
 * Cited to GitHub's own "Evaluate expressions in workflows and actions" page
 * (literals, operators, functions, status check functions, object filters)
 * and its "Contexts reference" page (the twelve context names), both fetched
 * 2026-09-26. This module never evaluates an expression -- there is no
 * runtime value for any context here, only syntax checking -- and it never
 * imports a general-purpose expression or JavaScript evaluator.
 */
import { isMap, isSeq, isScalar, type Document } from 'yaml';

/** Refused beyond this many characters (never a crash; D-109/AM). */
export const MAX_EXPRESSION_LENGTH = 8192;

/** Refused beyond this parenthesis/bracket/call nesting depth (never a crash). */
export const MAX_EXPRESSION_DEPTH = 256;

/**
 * The twelve context names GitHub's Contexts reference page lists:
 * https://docs.github.com/en/actions/learn-github-actions/contexts, fetched
 * 2026-09-26 ("Available contexts": github, env, vars, job, jobs, steps,
 * runner, secrets, strategy, matrix, needs, inputs).
 */
export const EXPRESSION_CONTEXTS = [
  'github',
  'env',
  'vars',
  'job',
  'jobs',
  'steps',
  'runner',
  'secrets',
  'strategy',
  'matrix',
  'needs',
  'inputs',
] as const;

export type ExpressionContext = (typeof EXPRESSION_CONTEXTS)[number];

/**
 * Every function GitHub's expressions page documents, with its accepted
 * argument count range. `format`/`hashFiles` take a variable number of
 * arguments (documented as "There is no maximum") so their `max` is
 * `Infinity`. The four status check functions (success/failure/cancelled/
 * always) take none.
 *
 * Matched case-insensitively: the fetched expressions page does not state
 * whether function names are case sensitive, but SchemaStore's own accepted
 * positive test workflow `workflow_call_input_issue_2501.yaml` calls
 * `fromJson` (lower-case j) where every other vendored example spells it
 * `fromJSON`, and GitHub accepts that file as valid -- empirical evidence
 * from GitHub's own accepted-workflow corpus, recorded here rather than
 * assumed from the page text alone.
 */
export const EXPRESSION_FUNCTIONS: Record<string, { min: number; max: number }> = {
  contains: { min: 2, max: 2 },
  startswith: { min: 2, max: 2 },
  endswith: { min: 2, max: 2 },
  format: { min: 2, max: Infinity },
  join: { min: 1, max: 2 },
  tojson: { min: 1, max: 1 },
  fromjson: { min: 1, max: 1 },
  hashfiles: { min: 1, max: Infinity },
  success: { min: 0, max: 0 },
  failure: { min: 0, max: 0 },
  cancelled: { min: 0, max: 0 },
  always: { min: 0, max: 0 },
};

/** The canonical (documented) spelling of each function name, keyed by its lower-case form -- used only for problem messages. */
const CANONICAL_FUNCTION_NAME: Record<string, string> = {
  contains: 'contains',
  startswith: 'startsWith',
  endswith: 'endsWith',
  format: 'format',
  join: 'join',
  tojson: 'toJSON',
  fromjson: 'fromJSON',
  hashfiles: 'hashFiles',
  success: 'success',
  failure: 'failure',
  cancelled: 'cancelled',
  always: 'always',
};

export interface ExpressionProblem {
  /** 0-based character offset into the text passed to parseExpression. */
  offset: number;
  message: string;
}

export interface ExpressionReference {
  /** The root context this reference reads (e.g. "steps"). */
  context: string;
  /** The full dotted path, including the context (e.g. "steps.build.outputs.x"). */
  path: string;
}

export interface ParseExpressionResult {
  ok: boolean;
  problems: ExpressionProblem[];
  references: ExpressionReference[];
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType =
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'dot'
  | 'star'
  | 'comma'
  | 'not'
  | 'lt'
  | 'le'
  | 'gt'
  | 'ge'
  | 'eq'
  | 'ne'
  | 'and'
  | 'or'
  | 'number'
  | 'string'
  | 'ident'
  | 'true'
  | 'false'
  | 'null'
  | 'eof';

interface Token {
  type: TokenType;
  text: string;
  offset: number;
}

const KEYWORDS: Record<string, TokenType> = { true: 'true', false: 'false', null: 'null' };

/**
 * Tokenizes GitHub's expression grammar. Whitespace, including embedded
 * newlines (a folded YAML block scalar's `if` value or a multi-line call
 * argument list both fold onto a single logical line before GitHub ever
 * evaluates them), is insignificant and skipped between tokens.
 *
 * An unterminated string pushes one problem and stops tokenizing at that
 * point (every following character is unreachable syntax); every other
 * unrecognised character pushes one problem and is skipped so the rest of
 * the expression can still be checked.
 */
function tokenize(text: string, problems: ExpressionProblem[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = text.length;

  const isIdentStart = (ch: string) => /[A-Za-z_]/.test(ch);
  const isIdentPart = (ch: string) => /[A-Za-z0-9_-]/.test(ch);
  const isDigit = (ch: string) => /[0-9]/.test(ch);

  while (i < n) {
    const ch = text[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    const start = i;

    if (ch === '(') {
      tokens.push({ type: 'lparen', text: ch, offset: start });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', text: ch, offset: start });
      i++;
      continue;
    }
    if (ch === '[') {
      tokens.push({ type: 'lbracket', text: ch, offset: start });
      i++;
      continue;
    }
    if (ch === ']') {
      tokens.push({ type: 'rbracket', text: ch, offset: start });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', text: ch, offset: start });
      i++;
      continue;
    }
    if (ch === '.') {
      tokens.push({ type: 'dot', text: ch, offset: start });
      i++;
      continue;
    }
    if (ch === '*') {
      tokens.push({ type: 'star', text: ch, offset: start });
      i++;
      continue;
    }
    if (ch === '!') {
      if (text[i + 1] === '=') {
        tokens.push({ type: 'ne', text: '!=', offset: start });
        i += 2;
      } else {
        tokens.push({ type: 'not', text: '!', offset: start });
        i++;
      }
      continue;
    }
    if (ch === '<') {
      if (text[i + 1] === '=') {
        tokens.push({ type: 'le', text: '<=', offset: start });
        i += 2;
      } else {
        tokens.push({ type: 'lt', text: '<', offset: start });
        i++;
      }
      continue;
    }
    if (ch === '>') {
      if (text[i + 1] === '=') {
        tokens.push({ type: 'ge', text: '>=', offset: start });
        i += 2;
      } else {
        tokens.push({ type: 'gt', text: '>', offset: start });
        i++;
      }
      continue;
    }
    if (ch === '=' && text[i + 1] === '=') {
      tokens.push({ type: 'eq', text: '==', offset: start });
      i += 2;
      continue;
    }
    if (ch === '&' && text[i + 1] === '&') {
      tokens.push({ type: 'and', text: '&&', offset: start });
      i += 2;
      continue;
    }
    if (ch === '|' && text[i + 1] === '|') {
      tokens.push({ type: 'or', text: '||', offset: start });
      i += 2;
      continue;
    }

    if (ch === "'") {
      i++;
      let value = '';
      let terminated = false;
      while (i < n) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i++;
          terminated = true;
          break;
        }
        value += text[i];
        i++;
      }
      if (!terminated) {
        problems.push({ offset: start, message: "This string is missing its closing quote (')." });
      }
      tokens.push({ type: 'string', text: value, offset: start });
      continue;
    }

    if (isDigit(ch) || (ch === '-' && isDigit(text[i + 1] ?? ''))) {
      let j = i + (ch === '-' ? 1 : 0);
      if (text[j] === '0' && (text[j + 1] === 'x' || text[j + 1] === 'X')) {
        j += 2;
        while (j < n && /[0-9a-fA-F]/.test(text[j]!)) j++;
      } else {
        while (j < n && isDigit(text[j]!)) j++;
        if (text[j] === '.') {
          j++;
          while (j < n && isDigit(text[j]!)) j++;
        }
        if (text[j] === 'e' || text[j] === 'E') {
          j++;
          if (text[j] === '+' || text[j] === '-') j++;
          while (j < n && isDigit(text[j]!)) j++;
        }
      }
      tokens.push({ type: 'number', text: text.slice(start, j), offset: start });
      i = j;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentPart(text[j]!)) j++;
      const word = text.slice(start, j);
      const keyword = KEYWORDS[word.toLowerCase()];
      tokens.push({ type: keyword ?? 'ident', text: word, offset: start });
      i = j;
      continue;
    }

    problems.push({ offset: start, message: `Unexpected character "${ch}" in this expression.` });
    i++;
  }

  tokens.push({ type: 'eof', text: '', offset: n });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Levenshtein edit distance, capped search, only for a "did you mean" suggestion. */
function editDistance(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = temp;
    }
  }
  return dp[b.length]!;
}

function closeMatch(name: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const distance = editDistance(name.toLowerCase(), candidate.toLowerCase());
    if (distance <= 2 && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

class ExpressionParser {
  private pos = 0;
  private depth = 0;
  private refused = false;
  readonly problems: ExpressionProblem[] = [];
  readonly references: ExpressionReference[] = [];

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private advance(): Token {
    const token = this.tokens[this.pos]!;
    if (token.type !== 'eof') this.pos++;
    return token;
  }

  private expect(type: TokenType, what: string): Token | undefined {
    if (this.peek().type === type) return this.advance();
    const at = this.peek();
    this.problems.push({
      offset: at.type === 'eof' ? at.offset : at.offset,
      message: `Expected ${what} here.`,
    });
    return undefined;
  }

  /** Guards every recursive descent step against runaway nesting (D-109/AM: never a crash, refused beyond MAX_EXPRESSION_DEPTH). */
  private enter(): boolean {
    this.depth++;
    if (this.depth > MAX_EXPRESSION_DEPTH && !this.refused) {
      this.refused = true;
      this.problems.push({
        offset: this.peek().offset,
        message: `This expression is nested more than ${MAX_EXPRESSION_DEPTH} levels deep, so it was refused rather than risk freezing the tab.`,
      });
    }
    return !this.refused;
  }

  private exit(): void {
    this.depth--;
  }

  parseProgram(): void {
    if (this.peek().type === 'eof') {
      this.problems.push({ offset: 0, message: 'This expression is empty.' });
      return;
    }
    this.parseOr();
    if (!this.refused && this.peek().type !== 'eof') {
      this.problems.push({
        offset: this.peek().offset,
        message: `Unexpected "${this.peek().text}" after the end of this expression.`,
      });
    }
  }

  private parseOr(): void {
    if (!this.enter()) return;
    this.parseAnd();
    while (!this.refused && this.peek().type === 'or') {
      this.advance();
      this.parseAnd();
    }
    this.exit();
  }

  private parseAnd(): void {
    if (!this.enter()) return;
    this.parseComparison();
    while (!this.refused && this.peek().type === 'and') {
      this.advance();
      this.parseComparison();
    }
    this.exit();
  }

  private static readonly COMPARISON_TYPES: TokenType[] = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'];

  private parseComparison(): void {
    if (!this.enter()) return;
    this.parseUnary();
    while (!this.refused && ExpressionParser.COMPARISON_TYPES.includes(this.peek().type)) {
      this.advance();
      this.parseUnary();
    }
    this.exit();
  }

  private parseUnary(): void {
    if (!this.enter()) return;
    if (this.peek().type === 'not') {
      this.advance();
      this.parseUnary();
    } else {
      this.parsePostfix();
    }
    this.exit();
  }

  private parsePostfix(): void {
    if (!this.enter()) return;
    const primaryToken = this.peek();
    const primary = this.parsePrimary();
    if (this.refused) {
      this.exit();
      return;
    }

    // A bare identifier immediately followed by "(" is a function call; this
    // is the only place a call can start (a property chain is never itself
    // callable, e.g. "github.event()" is not valid syntax here).
    if (primary?.kind === 'ident' && this.peek().type === 'lparen') {
      this.parseCall(primary.name, primaryToken.offset);
      this.exit();
      return;
    }

    // Otherwise, a bare identifier that names a known context (or looks like
    // one) starts a context reference; track its dotted path as we descend
    // through property/index/filter segments.
    const context = primary?.kind === 'ident' ? primary.name : undefined;
    let path = context;
    const isContextRoot = primary?.kind === 'ident';

    for (;;) {
      if (this.peek().type === 'dot') {
        this.advance();
        if (this.peek().type === 'star') {
          this.advance();
          if (path !== undefined) path += '.*';
          continue;
        }
        const prop = this.expect('ident', 'a property name after "."');
        if (prop && path !== undefined) path += `.${prop.text}`;
        continue;
      }
      if (this.peek().type === 'lbracket') {
        this.advance();
        this.parseOr();
        this.expect('rbracket', 'a closing "]"');
        if (path !== undefined) path += '[]';
        continue;
      }
      break;
    }

    if (isContextRoot && path !== undefined && context !== undefined) {
      this.references.push({ context, path });
      if (!EXPRESSION_CONTEXTS.includes(context as ExpressionContext)) {
        const suggestion = closeMatch(context, EXPRESSION_CONTEXTS);
        this.problems.push({
          offset: primaryToken.offset,
          message: suggestion
            ? `"${context}" is not a context this grammar defines -- did you mean "${suggestion}"?`
            : `"${context}" is not a context this grammar defines.`,
        });
      }
    }

    this.exit();
  }

  private parseCall(name: string, nameOffset: number): void {
    this.advance(); // consume "("
    const args: void[] = [];
    if (this.peek().type !== 'rparen') {
      this.parseOr();
      args.push(undefined);
      while (!this.refused && this.peek().type === 'comma') {
        this.advance();
        this.parseOr();
        args.push(undefined);
      }
    }
    this.expect('rparen', 'a closing ")"');

    const key = name.toLowerCase();
    const spec = EXPRESSION_FUNCTIONS[key];
    if (!spec) {
      const suggestion = closeMatch(name, Object.values(CANONICAL_FUNCTION_NAME));
      this.problems.push({
        offset: nameOffset,
        message: suggestion
          ? `"${name}" is not a function this grammar defines -- did you mean "${suggestion}"?`
          : `"${name}" is not a function this grammar defines.`,
      });
      return;
    }
    if (args.length < spec.min || args.length > spec.max) {
      const canonical = CANONICAL_FUNCTION_NAME[key] ?? name;
      const range =
        spec.max === Infinity
          ? `at least ${spec.min}`
          : spec.min === spec.max
            ? `exactly ${spec.min}`
            : `between ${spec.min} and ${spec.max}`;
      this.problems.push({
        offset: nameOffset,
        message: `"${canonical}" takes ${range} argument${spec.min === 1 && spec.max === 1 ? '' : 's'}, not ${args.length}.`,
      });
    }
  }

  private parsePrimary(): { kind: 'ident'; name: string } | undefined {
    if (!this.enter()) return undefined;
    const token = this.peek();

    if (token.type === 'lparen') {
      this.advance();
      this.parseOr();
      this.expect('rparen', 'a closing ")"');
      this.exit();
      return undefined;
    }
    if (
      token.type === 'number' ||
      token.type === 'string' ||
      token.type === 'true' ||
      token.type === 'false' ||
      token.type === 'null'
    ) {
      this.advance();
      this.exit();
      return undefined;
    }
    if (token.type === 'ident') {
      this.advance();
      this.exit();
      return { kind: 'ident', name: token.text };
    }

    this.problems.push({
      offset: token.offset,
      message:
        token.type === 'eof'
          ? 'This expression ends where a value was expected.'
          : `Expected a value here, not "${token.text}".`,
    });
    this.exit();
    return undefined;
  }
}

/**
 * Parses `text` (the content between `${{` and `}}`, or a whole delimiter-
 * less `if` value) as one GitHub Actions expression. Never evaluates
 * anything -- there is no runtime value for any context in this package --
 * and never throws; a malformed expression is reported through `problems`.
 * Refused, without a crash, beyond `MAX_EXPRESSION_LENGTH` characters or
 * `MAX_EXPRESSION_DEPTH` levels of nesting.
 */
export function parseExpression(text: string): ParseExpressionResult {
  if (text.length > MAX_EXPRESSION_LENGTH) {
    return {
      ok: false,
      problems: [
        {
          offset: 0,
          message: `This expression is longer than ${MAX_EXPRESSION_LENGTH} characters, so it was refused rather than risk freezing the tab.`,
        },
      ],
      references: [],
    };
  }

  const problems: ExpressionProblem[] = [];
  const tokens = tokenize(text, problems);
  const parser = new ExpressionParser(tokens);
  parser.parseProgram();
  problems.push(...parser.problems);

  return { ok: problems.length === 0, problems, references: parser.references };
}

// ---------------------------------------------------------------------------
// Finding expression spans in raw YAML source
// ---------------------------------------------------------------------------

export interface ExpressionSpan {
  /** The raw text between (not including) the "${{" and "}}" delimiters, or the whole raw value for a delimiter-less "if". */
  text: string;
  /** Absolute character offset, into the ORIGINAL document text, of the first character of `text`. */
  start: number;
  /** True for a delimiter-less "if" value (GitHub's own documented exception) rather than an explicit "${{ }}" span. */
  implicit: boolean;
}

/**
 * Scans `raw` (already sliced from a scalar node's own source range, so
 * offsets returned are relative to the START of `raw`) for `${{` ... `}}`
 * pairs, skipping over single-quoted string spans so a literal `}}` written
 * as part of an escaped brace pair inside a string (GitHub's own `format`
 * escaping example, `format('{{Hello {0}!}}', x)`) never terminates a span
 * early. An unterminated `${{` (no closing `}}` before the end of `raw`)
 * still returns one span, running to the end of `raw`, so the parser itself
 * can report the specific unterminated-expression problem at the right
 * offset instead of this scanner silently dropping it.
 */
export function findExpressionSpans(raw: string): ExpressionSpan[] {
  const spans: ExpressionSpan[] = [];
  let i = 0;
  while (i < raw.length) {
    const start = raw.indexOf('${{', i);
    if (start === -1) break;
    let j = start + 3;
    let inString = false;
    let end = -1;
    while (j < raw.length) {
      const ch = raw[j];
      if (inString) {
        if (ch === "'") {
          if (raw[j + 1] === "'") {
            j += 2;
            continue;
          }
          inString = false;
        }
        j++;
        continue;
      }
      if (ch === "'") {
        inString = true;
        j++;
        continue;
      }
      if (ch === '}' && raw[j + 1] === '}') {
        end = j;
        break;
      }
      j++;
    }
    if (end === -1) {
      spans.push({ text: raw.slice(start + 3), start: start + 3, implicit: false });
      break;
    }
    spans.push({ text: raw.slice(start + 3, end), start: start + 3, implicit: false });
    i = end + 2;
  }
  return spans;
}

export interface FoundExpression {
  span: ExpressionSpan;
  /** Absolute character offset into the whole document's original text. */
  absoluteStart: number;
  pointer: string;
}

function pointerSegment(token: string | number): string {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointerFrom(tokens: (string | number)[]): string {
  if (tokens.length === 0) return '';
  return '/' + tokens.map(pointerSegment).join('/');
}

/**
 * Walks the whole parsed document looking for every scalar node, and
 * returns one `FoundExpression` per `${{ }}` span (or, for a job or step
 * `if` key holding a value with no `${{` delimiters at all, one
 * `FoundExpression` for the whole raw value -- GitHub's own documented
 * exception, "Evaluate expressions in workflows and actions": an `if`
 * conditional's `${{ }}` syntax may be omitted). Offsets in the returned
 * spans are absolute character offsets into `fullText`, computed once here
 * from each scalar node's own `range`, so a caller with a `LineCounter` can
 * turn them directly into line/column without re-deriving anything about
 * folded or quoted scalar escaping.
 */
export function findExpressions(fullText: string, doc: Document.Parsed): FoundExpression[] {
  const found: FoundExpression[] = [];

  function visit(node: unknown, tokens: (string | number)[]): void {
    if (isMap(node)) {
      for (const pair of node.items) {
        const keyNode = pair.key as { value?: unknown } | null;
        const keyToken = keyNode && typeof keyNode === 'object' && 'value' in keyNode ? String(keyNode.value) : '';
        visit(pair.value, [...tokens, keyToken]);
      }
      return;
    }
    if (isSeq(node)) {
      node.items.forEach((item, i) => visit(item, [...tokens, i]));
      return;
    }
    if (isScalar(node) && node.range) {
      const [rangeStart, rangeEnd] = node.range;
      const raw = fullText.slice(rangeStart, rangeEnd);
      const keyName = tokens[tokens.length - 1];
      const pointer = pointerFrom(tokens);

      if (keyName === 'if' && !raw.includes('${{')) {
        // A block scalar's own range includes its header line ("|", ">-",
        // "|+2", ...), which is YAML syntax, not part of the value GitHub
        // evaluates -- stripped here so the implicit expression text below
        // is exactly the folded body, while the reported offset stays byte-
        // accurate (bodyStart is still counted from rangeStart).
        const headerMatch = /^[|>][+-]?[0-9]*\r?\n/.exec(raw);
        const bodyStart = headerMatch ? headerMatch[0].length : 0;
        const body = raw.slice(bodyStart);
        if (body.trim() !== '') {
          found.push({
            span: { text: body, start: bodyStart, implicit: true },
            absoluteStart: rangeStart + bodyStart,
            pointer,
          });
        }
        return;
      }
      if (!raw.includes('${{')) return;
      for (const span of findExpressionSpans(raw)) {
        found.push({ span, absoluteStart: rangeStart + span.start, pointer });
      }
    }
  }

  visit(doc.contents, []);
  return found;
}
