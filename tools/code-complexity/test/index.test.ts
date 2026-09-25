import { it, expect, vi } from 'vitest';
import { Linter } from 'eslint';
import ts from 'typescript';
import { analyseComplexity, CodeComplexityError } from '../src/index';
import { NEVER_RUN_JS, NEVER_RUN_TS, assertNeverRan } from './never-evaluates';

/**
 * Runs the real, installed ESLint `complexity` rule (classic variant,
 * threshold 0, so every function is reported) over `source` and returns one
 * row per reported function, in source order (ESLint reports in the order
 * each code path *ends*, i.e. innermost/earliest-closing first -- sorted
 * here by starting line so it can be zipped against this tool's own
 * source-order rows).
 */
function eslintComplexities(source: string): { line: number; complexity: number }[] {
  const linter = new Linter();
  const messages = linter.verify(source, {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: { complexity: ['error', 0] },
  });
  const rows = messages.map((m) => {
    const match = /has a complexity of (\d+)\./.exec(m.message);
    if (!match) throw new Error(`unexpected ESLint message: ${m.message}`);
    return { line: m.line, complexity: Number(match[1]) };
  });
  return rows.sort((a, b) => a.line - b.line);
}

// A corpus covering every construct the classic complexity variant counts:
// if/else-if/else, logical operators (&&, ||, ??), for/for-in/for-of,
// while/do-while, try/catch, switch (case vs default), a default parameter,
// optional member access and call, logical assignment, a nested arrow
// function, an object method, a class method, a class field initializer
// holding an arrow function, and a class static block.
const CORPUS = `
function ifElseIf(x) {
  if (x === 1) {
    return 1;
  } else if (x === 2) {
    return 2;
  } else {
    return 3;
  }
}

function logicalOps(a, b, c, d) {
  return (a && b) || (c ?? d);
}

function loops(items) {
  for (const item of items) {
    if (item) continue;
  }
  for (let i = 0; i < items.length; i++) {
    /* noop */
  }
  for (const key in items) {
    /* noop */
  }
  let i = 0;
  while (i < 10) {
    i++;
  }
  do {
    i++;
  } while (i < 20);
  return i;
}

function tryCatch() {
  try {
    return 1;
  } catch (e) {
    return 2;
  }
}

function switchCases(x) {
  switch (x) {
    case 1:
      return 'a';
    case 2:
      return 'b';
    default:
      return 'c';
  }
}

function defaultParam(a = 1) {
  return a;
}

function optionalChaining(obj) {
  return obj?.foo?.();
}

let counter = 0;
function logicalAssignment() {
  counter ||= 1;
  counter &&= 2;
  counter ??= 3;
  return counter;
}

function outer(x) {
  const inner = (y) => {
    if (y) return 1;
    return 0;
  };
  return inner(x);
}

const obj = {
  method(x) {
    if (x) return 1;
    return 0;
  },
};

class Widget {
  value = () => {
    if (this.flag) return 1;
    return 0;
  };

  method(x) {
    if (x) return 1;
    return 0;
  }

  static {
    if (globalThis.DEBUG) {
      counter = 1;
    }
  }
}
`;

it('complexity equals the ESLint complexity rule for every function in the corpus', () => {
  // Compared as a multiset of (line, complexity) pairs rather than a strict
  // positional zip: a class field initializer holding a function is reported
  // as TWO rows at the very same line by both ESLint and this tool (one for
  // the "class field initializer" origin, one for the function itself,
  // matching the installed rule's own onCodePathEnd behaviour, confirmed
  // directly against it) -- their relative order there depends on internal
  // traversal details neither tool's own contract promises, only the set of
  // reported complexities at each line does.
  const key = (r: { line: number; complexity: number }) => `${r.line}:${r.complexity}`;
  const eslintRows = eslintComplexities(CORPUS).map(key).sort();
  const { functions } = analyseComplexity(CORPUS, { language: 'javascript' });
  const ourRows = functions.map(key).sort();

  expect(ourRows, JSON.stringify(functions.map((f) => `${f.line}:${f.name}:${f.complexity}`))).toEqual(eslintRows);
});

it('the ESLint complexity rule documentation examples give their documented complexity', () => {
  // https://eslint.org/docs/latest/rules/complexity (fetched 2026-09-25), the
  // rule's own first example:
  //   function a(x) {
  //     if (true) {
  //       return x; // 1st path
  //     } else if (false) {
  //       return x+1; // 2nd path
  //     } else {
  //       return 4; // 3rd path
  //     }
  //   }
  // documented and confirmed against the installed rule (threshold 0) as
  // complexity 3.
  const source = `function a(x) {
  if (true) {
    return x;
  } else if (false) {
    return x+1;
  } else {
    return 4;
  }
}`;
  const { functions } = analyseComplexity(source);
  expect(functions).toHaveLength(1);
  expect(functions[0]!.complexity).toBe(3);
  expect(eslintComplexities(source)).toEqual([{ line: 1, complexity: 3 }]);
});

it('function length counts physical lines and lines holding code', () => {
  const source = `function f(a) {
  // a leading comment, not code
  if (a) {

    return 1;
  }
  return 2;
}`;
  const { functions } = analyseComplexity(source);
  expect(functions).toHaveLength(1);
  // 8 physical lines (the function's own span); one comment-only line and
  // one blank line inside excluded from codeLines, leaving 6.
  expect(functions[0]!.lines).toBe(8);
  expect(functions[0]!.codeLines).toBe(6);
});

it('nested functions are measured separately and do not add to their parent', () => {
  const source = `function outer(x) {
  const inner = (y) => {
    if (y) return 1;
    return 0;
  };
  return inner(x);
}`;
  const { functions } = analyseComplexity(source);
  expect(functions).toHaveLength(2);
  const outer = functions.find((f) => f.name === 'outer')!;
  const inner = functions.find((f) => f.name === 'inner')!;
  expect(outer.complexity).toBe(1); // no branching of its own: the if lives inside `inner`
  expect(inner.complexity).toBe(2); // base 1 + the if
});

it('a syntax error is reported with its line and column', () => {
  const source = 'function f() {\n  if (x {\n}';
  expect(() => analyseComplexity(source)).toThrow(CodeComplexityError);
  try {
    analyseComplexity(source);
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(CodeComplexityError);
    const e = err as CodeComplexityError;
    expect(e.line).toBeGreaterThan(0);
    expect(e.column).toBeGreaterThan(0);
  }
});

it('deeply nested code is analysed without overflowing the stack', () => {
  // @babel/parser's own recursive-descent parser is the binding constraint on
  // how deep nested input can go at all (confirmed directly: this same
  // engine's parser throws its own "Maximum call stack size exceeded" for an
  // `if`-nesting depth around 700 on this machine, independent of anything
  // this tool does -- the same upstream limit ts-to-js's own stripTypes
  // documents for TypeScript's parser). A depth comfortably under that,
  // picked conservatively so the parser itself succeeds across machines and
  // Node versions, exercises what this tool DOES control: `walk` uses an
  // explicit stack, never recursion, so it adds no overflow risk of its own
  // on top of whatever the parser can already handle.
  const depth = 300;
  const source = `function deep(x) {\n${'if (x) {\n'.repeat(depth)}return 1;\n${'}\n'.repeat(depth)}return 0;\n}`;
  expect(() => analyseComplexity(source)).not.toThrow();
  const { functions } = analyseComplexity(source);
  expect(functions).toHaveLength(1);
  expect(functions[0]!.complexity).toBe(depth + 1);
});

it('TypeScript types add no complexity: the same functions after type stripping give the same numbers', () => {
  const tsSource = `function generic<T>(a: T, b: T | null): T {
  if (b === null) {
    return a;
  }
  return b as T;
}

function nonNull(a: string | undefined): string {
  return a!;
}`;
  const { functions: tsFunctions } = analyseComplexity(tsSource, { language: 'typescript' });

  const stripped = ts.transpileModule(tsSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const { functions: jsFunctions } = analyseComplexity(stripped, { language: 'javascript' });

  expect(tsFunctions.map((f) => f.complexity)).toEqual(jsFunctions.map((f) => f.complexity));
  expect(tsFunctions.map((f) => f.name)).toEqual(jsFunctions.map((f) => f.name));
});

it('analysing never runs the pasted code', async () => {
  await assertNeverRan(() => analyseComplexity(NEVER_RUN_JS, { language: 'javascript' }));
  await assertNeverRan(() => analyseComplexity(NEVER_RUN_TS, { language: 'typescript' }));
});

it('nothing is written to the console while analysing', () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  try {
    analyseComplexity(CORPUS, { language: 'javascript' });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
