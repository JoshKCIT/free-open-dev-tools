import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as babelParser from '@babel/parser';
import { formatJs, JsFormatterError } from '../src/index';
import { NEVER_RUN_JS, NEVER_RUN_TS, assertNeverRan } from './never-evaluates';

vi.mock('terser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('terser')>();
  return { ...actual, minify: vi.fn(actual.minify) };
});

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
  vi.clearAllMocks();
});

/** Strips position/comment metadata so two ASTs can be compared for structural equality only. */
function stripMeta(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripMeta);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (
        [
          'start',
          'end',
          'loc',
          'range',
          'extra',
          'leadingComments',
          'trailingComments',
          'innerComments',
          'comments',
        ].includes(key)
      ) {
        continue;
      }
      out[key] = stripMeta(value);
    }
    return out;
  }
  return node;
}

function parseTree(source: string, typescript: boolean): unknown {
  const ast = babelParser.parse(source, {
    sourceType: 'module',
    plugins: typescript ? ['typescript', 'jsx'] : ['jsx'],
  });
  return stripMeta(ast.program);
}

it('ECMA-262 syntax beautifies to the same syntax tree as the original', async () => {
  const corpus = [
    'class Counter { #count = 0; increment() { this.#count++; } }',
    'async function* gen() { yield await Promise.resolve(1); }',
    'const { a, b: [c, ...rest] } = obj;',
    'const value = a?.b?.[0]?.();',
    'const re = /a\\/b+/gi;',
    'const tpl = `hello ${name}, it is ${1 + 1}`;',
    'const el = <div className="a">{x}</div>;',
  ];
  for (const source of corpus) {
    const result = await formatJs(source, { language: 'javascript', mode: 'beautify' });
    expect(parseTree(result.output, false)).toEqual(parseTree(source, false));
  }
});

it('TypeScript generics, interfaces, enums and satisfies beautify to the same syntax tree', async () => {
  const source =
    'interface Box<T> { value: T }\n' +
    'function wrap<T>(v: T): Box<T> { return { value: v } satisfies Box<T>; }\n' +
    'enum Color { Red, Green, Blue }';
  const result = await formatJs(source, { language: 'typescript', mode: 'beautify' });
  expect(result.output).toContain('interface Box<T>');
  expect(result.output).toContain('enum Color');
  expect(result.output).toContain('satisfies Box<T>');
  expect(parseTree(result.output, true)).toEqual(parseTree(source, true));
});

it('the Prettier bracket spacing documentation example gives the documented output', async () => {
  // https://github.com/prettier/prettier/blob/3.9.9/docs/options.md#bracket-spacing
  // Default true: "Example: `{ foo: bar }`."
  const result = await formatJs('const a = {foo: bar};', { language: 'javascript', mode: 'beautify' });
  expect(result.output).toContain('{ foo: bar }');
});

it('minified JavaScript keeps every export name and string literal and is shorter', async () => {
  const source =
    "export function greet(personName) { return 'hello, ' + personName + '!'; }\n" +
    "export const GREETING_PREFIX = 'hello, ';\n";
  const result = await formatJs(source, { language: 'javascript', mode: 'minify' });
  expect(result.output).toContain('export function greet');
  expect(result.output).toContain('export const GREETING_PREFIX');
  expect(result.output).toContain('hello, ');
  expect(result.outputBytes).toBeLessThan(result.inputBytes);
});

it('minified TypeScript contains no type annotation and still parses as JavaScript', async () => {
  const source =
    'export function greet(name: string): string {\n  const upper: string = name.toUpperCase();\n  return upper;\n}\n';
  const result = await formatJs(source, { language: 'typescript', mode: 'minify' });
  expect(result.output).not.toContain(': string');
  expect(result.warnings.some((w) => w.includes('JavaScript'))).toBe(true);
  // Parses as plain JavaScript with no typescript plugin needed.
  expect(() => babelParser.parse(result.output, { sourceType: 'module' })).not.toThrow();
});

it('terser runs with every unsafe option off', async () => {
  const terser = await import('terser');
  await formatJs('function f(a) { return a + 1; }', { language: 'javascript', mode: 'minify' });
  expect(terser.minify).toHaveBeenCalled();
  const calls = (terser.minify as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const options = calls[calls.length - 1]![1] as Record<string, unknown>;
  const compress = options.compress;
  expect(compress).not.toBe(false);
  if (compress && typeof compress === 'object') {
    for (const [key, value] of Object.entries(compress as Record<string, unknown>)) {
      if (key.startsWith('unsafe')) expect(value).not.toBe(true);
    }
  }
});

it('beautifying and minifying never run the pasted code', async () => {
  await assertNeverRan(() => formatJs(NEVER_RUN_JS, { language: 'javascript', mode: 'beautify' }));
  await assertNeverRan(() => formatJs(NEVER_RUN_JS, { language: 'javascript', mode: 'minify' }));
  await assertNeverRan(() => formatJs(NEVER_RUN_TS, { language: 'typescript', mode: 'beautify' }));
  await assertNeverRan(() => formatJs(NEVER_RUN_TS, { language: 'typescript', mode: 'minify' }));
});

it('a syntax error is reported with its line and column from either library', async () => {
  // Prettier's own parser error path (beautify).
  try {
    await formatJs('const a = {', { language: 'javascript', mode: 'beautify' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(JsFormatterError);
    const e = err as JsFormatterError;
    expect(e.line).toBe(1);
    expect(typeof e.column).toBe('number');
  }

  // terser's own parser error path (minify), 0-based column converted to 1-based.
  try {
    await formatJs('const a = ;', { language: 'javascript', mode: 'minify' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(JsFormatterError);
    const e = err as JsFormatterError;
    expect(e.line).toBe(1);
    expect(e.column).toBe(11);
  }
});

it('nothing is written to the console while formatting or minifying', async () => {
  await formatJs('const a = { b: 1 };', { language: 'javascript', mode: 'beautify' });
  await formatJs('const a = { b: 1 };', { language: 'javascript', mode: 'minify' });
  await formatJs('const a: number = 1;', { language: 'typescript', mode: 'beautify' });
  await formatJs('const a: number = 1;', { language: 'typescript', mode: 'minify' });
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});
