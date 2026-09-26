import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import {
  parseExpression,
  findExpressions,
  findExpressionSpans,
  EXPRESSION_FUNCTIONS,
  EXPRESSION_CONTEXTS,
  MAX_EXPRESSION_LENGTH,
  MAX_EXPRESSION_DEPTH,
} from '../src/expressions';

const STARTER_DIR = join(__dirname, 'fixtures', 'starter-workflows');
const POSITIVE_DIR = join(__dirname, 'fixtures', 'schemastore', 'test', 'github-workflow');

/**
 * Quoted from GitHub's own "Evaluate expressions in workflows and actions"
 * page (https://docs.github.com/en/actions/learn-github-actions/expressions,
 * fetched 2026-09-26), "Literals" section:
 *
 *   Data type | Literal value
 *   boolean   | true or false
 *   null      | null
 *   number    | Any number format supported by JSON.
 *   string    | You don't need to enclose strings in ${{ and }}. However, if
 *             | you do, you must use single quotes (') around the string. To
 *             | use a literal single quote, escape the literal single quote
 *             | using an additional single quote (''). Wrapping with double
 *             | quotes (") will throw an error.
 *
 * Example literals from the same page: `null`, `false`, `711`, `-9.2`,
 * `0xff`, `-2.99e-2`, `'It''s open source!'`.
 */
it('expression syntax follows the GitHub expressions documentation for literals, operators and property access', () => {
  for (const text of ['null', 'true', 'false', '711', '-9.2', '0xff', '-2.99e-2', "'It''s open source!'"]) {
    expect(parseExpression(text).ok, text).toBe(true);
  }
  expect(parseExpression("github.event_name == 'push'").ok).toBe(true);
  expect(parseExpression('github.event.issue.labels.*.name').ok).toBe(true);
  expect(parseExpression("secrets['TOKEN']").ok).toBe(true);
  // Double-quoted strings are documented to throw an error.
  expect(parseExpression('"push"').ok).toBe(false);
});

/**
 * Quoted from the same page's "Operators" table (fetched 2026-09-26), in the
 * order the page lists them: ( ) grouping, [ ] index, . property, ! not,
 * < <= > >= comparison, == != equality, && and, || or. This is also the
 * order this parser's grammar binds them (weakest to strongest: ||, &&,
 * comparisons, unary !, postfix, primary), matching a standard C-family
 * expression language and confirmed directly against the operator examples
 * on the page (e.g. `!cancelled()`, `github.ref == 'refs/heads/main'`).
 */
it('operator precedence follows the table in the GitHub expressions documentation', () => {
  // && binds tighter than ||: this parses as (false && false) || true.
  expect(parseExpression('false && false || true').ok).toBe(true);
  // A comparison binds tighter than && and ||.
  expect(parseExpression('1 == 1 && 2 == 2 || 3 == 4').ok).toBe(true);
  // ! binds to the single following postfix expression only.
  expect(parseExpression('!cancelled() && success()').ok).toBe(true);
  // Parentheses override the default grouping.
  expect(parseExpression("(github.event_name == 'push' && !cancelled())").ok).toBe(true);
});

it('an unbalanced or unterminated expression is reported at its line and column', () => {
  const unbalancedParen = parseExpression("contains(github.ref, 'main'");
  expect(unbalancedParen.ok).toBe(false);
  expect(unbalancedParen.problems.some((p) => /closing "\)"/.test(p.message))).toBe(true);

  const unterminatedString = parseExpression("format('{0}");
  expect(unterminatedString.ok).toBe(false);
  expect(unterminatedString.problems.some((p) => /closing quote/.test(p.message))).toBe(true);

  const unbalancedBracket = parseExpression("secrets['TOKEN'");
  expect(unbalancedBracket.ok).toBe(false);
  expect(unbalancedBracket.problems.some((p) => /closing "\]"/.test(p.message))).toBe(true);

  // findExpressionSpans' own string-aware scanning: a literal "}}" written
  // as part of an escaped brace pair inside a single-quoted string (GitHub's
  // own format() escaping example) never terminates a span early.
  const spans = findExpressionSpans("${{ format('{{Hello {0}!}}', 'x') }}");
  expect(spans.length).toBe(1);
  expect(spans[0]!.text.trim()).toBe("format('{{Hello {0}!}}', 'x')");
});

it('an unknown function or a known function with the wrong number of arguments is reported', () => {
  const unknownFunction = parseExpression("notAFunction('x')");
  expect(unknownFunction.ok).toBe(false);
  expect(unknownFunction.problems.some((p) => p.message.includes('notAFunction'))).toBe(true);

  const wrongArgCount = parseExpression('format()');
  expect(wrongArgCount.ok).toBe(false);
  expect(wrongArgCount.problems.some((p) => p.message.includes('format'))).toBe(true);

  // Every documented function's own argument-count range round-trips: the
  // lower bound is accepted, one fewer is refused.
  for (const [name, spec] of Object.entries(EXPRESSION_FUNCTIONS)) {
    const args = Array.from({ length: spec.min }, (_, i) => `'a${i}'`).join(', ');
    expect(parseExpression(`${name}(${args})`).ok, `${name} at its minimum arg count`).toBe(true);
    if (spec.min > 0) {
      const tooFew = Array.from({ length: spec.min - 1 }, (_, i) => `'a${i}'`).join(', ');
      expect(parseExpression(`${name}(${tooFew})`).ok, `${name} with one argument too few`).toBe(false);
    }
  }

  // fromJson (lower-case J) is accepted the same as fromJSON: see
  // EXPRESSION_FUNCTIONS' own comment (SchemaStore's own accepted
  // workflow_call_input_issue_2501.yaml positive test fixture spells it
  // this way).
  expect(parseExpression("fromJson('[]')").ok).toBe(true);
  expect(parseExpression("fromJSON('[]')").ok).toBe(true);
});

it('an unknown context name is reported and every documented context is accepted', () => {
  const unknownContext = parseExpression('secret.TOKEN');
  expect(unknownContext.ok).toBe(false);
  expect(unknownContext.problems.some((p) => p.message.includes('secret') && p.message.includes('secrets'))).toBe(true);

  for (const context of EXPRESSION_CONTEXTS) {
    const result = parseExpression(`${context}.someProperty`);
    expect(result.ok, context).toBe(true);
    expect(result.references.some((r) => r.context === context)).toBe(true);
  }
});

it('an if condition without the expression delimiters is read as an expression as GitHub documents', () => {
  const text =
    "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    if: github.ref == 'refs/heads/main'\n    steps:\n      - run: echo hi\n";
  const doc = parseDocument(text);
  const found = findExpressions(text, doc);
  const ifExpressions = found.filter((f) => f.pointer.endsWith('/if'));
  expect(ifExpressions.length).toBe(1);
  expect(ifExpressions[0]!.span.implicit).toBe(true);
  const parsed = parseExpression(ifExpressions[0]!.span.text);
  expect(parsed.ok, JSON.stringify(parsed.problems)).toBe(true);

  // A boolean or number if value (GitHub's own documented literals) is read
  // as an expression the same way.
  for (const rawIf of ['true', 'false', '0']) {
    const t = `on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    if: ${rawIf}\n    steps:\n      - run: echo hi\n`;
    const d = parseDocument(t);
    const f = findExpressions(t, d).filter((x) => x.pointer.endsWith('/if'));
    expect(f.length, rawIf).toBe(1);
    expect(parseExpression(f[0]!.span.text).ok, rawIf).toBe(true);
  }
});

it('every expression in the vendored starter and SchemaStore workflows parses with no problem', () => {
  const files = [
    ...readdirSync(STARTER_DIR)
      .filter((f) => f.endsWith('.yml'))
      .map((f) => join(STARTER_DIR, f)),
    ...readdirSync(POSITIVE_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => join(POSITIVE_DIR, f)),
  ];
  let total = 0;
  for (const file of files) {
    let text = readFileSync(file, 'utf8');
    if (file.startsWith(STARTER_DIR)) {
      text = text.replace(/\$default-branch/g, 'main').replace(/\$protected-branches/g, 'main');
    }
    let doc;
    try {
      doc = parseDocument(text);
    } catch {
      continue;
    }
    if (doc.errors.length > 0) continue;
    const found = findExpressions(text, doc);
    for (const expr of found) {
      const result = parseExpression(expr.span.text);
      total++;
      expect(
        result.ok,
        `${file} ${expr.pointer}: ${JSON.stringify(result.problems)} in ${JSON.stringify(expr.span.text)}`,
      ).toBe(true);
    }
  }
  expect(total).toBeGreaterThan(20);
});

it('an over-long or over-deep expression is refused without a crash', () => {
  const long = 'a'.repeat(MAX_EXPRESSION_LENGTH + 1);
  const longResult = parseExpression(long);
  expect(longResult.ok).toBe(false);
  expect(longResult.problems[0]!.message).toContain(String(MAX_EXPRESSION_LENGTH));

  const deep = '('.repeat(MAX_EXPRESSION_DEPTH + 50) + '1' + ')'.repeat(MAX_EXPRESSION_DEPTH + 50);
  expect(() => parseExpression(deep)).not.toThrow();
  const deepResult = parseExpression(deep);
  expect(deepResult.ok).toBe(false);
});
