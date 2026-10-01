import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { loadEngine, formatDart, DartFormatterError, meta as toolMeta, type FormatDartOptions } from '../src/index';
import * as F from './fixtures/dart-style/golden';

// The engine entry is wrapped only to COUNT calls and to RECORD the configuration it is called with, so a test can
// prove blank input and refused options never reach the engine and that the line width arrives under the engine's
// own option name, and to make loading fail on demand with the error a browser without WebAssembly garbage
// collection gives. Otherwise the wrapper calls straight through; it is a spy, never an oracle.
const engineControl = vi.hoisted(() => ({
  count: 0,
  lastFileName: undefined as undefined | string,
  lastConfig: undefined as undefined | Record<string, unknown>,
  initError: undefined as unknown,
  lastInitArgument: undefined as unknown,
}));
vi.mock('@wasm-fmt/dart_fmt/web', async (importOriginal) => {
  const real = await importOriginal<typeof import('@wasm-fmt/dart_fmt/web')>();
  return {
    ...real,
    initSync: (...args: Parameters<typeof real.initSync>) => {
      engineControl.lastInitArgument = args[0];
      if (engineControl.initError !== undefined) throw engineControl.initError;
      return real.initSync(...args);
    },
    format: (...args: Parameters<typeof real.format>) => {
      engineControl.count += 1;
      engineControl.lastFileName = args[1];
      engineControl.lastConfig = args[2] as Record<string, unknown> | undefined;
      return real.format(...args);
    },
  };
});

const require = createRequire(import.meta.url);
const wasmBytes = (): Uint8Array => new Uint8Array(readFileSync(require.resolve('@wasm-fmt/dart_fmt/wasm')));

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeAll(() => {
  loadEngine(wasmBytes());
});

beforeEach(() => {
  engineControl.count = 0;
  engineControl.lastFileName = undefined;
  engineControl.lastConfig = undefined;
  engineControl.initError = undefined;
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  for (const spy of consoleSpies) spy.mockRestore();
});

/** Runs formatDart and returns the DartFormatterError it must throw. */
function failureOf(source: string, options: Partial<FormatDartOptions> = {}): DartFormatterError {
  try {
    formatDart(source, options);
  } catch (err) {
    expect(err).toBeInstanceOf(DartFormatterError);
    return err as DartFormatterError;
  }
  throw new Error('formatDart returned a result for source that must be refused');
}

// Fixtures: dart_style v3.1.4, test/tall/top_level/import.unit and test/tall/regression/0000/0084.unit.
// URL: https://github.com/dart-lang/dart_style/tree/v3.1.4/test/tall (BSD-3-Clause, see ./fixtures/dart-style/LICENSE)

it('dart_style tall fixtures: the import cases reproduce at their declared 40 column width', () => {
  // The file's first line, `40 columns` then a bar at column 40, is a page width of 40.
  expect(F.IMPORT_UNIT_WIDTH).toBe(40);
  expect(F.IMPORT_UNIT_CASES).toHaveLength(15);
  for (const c of F.IMPORT_UNIT_CASES) {
    const result = formatDart(c.input, { lineWidth: F.IMPORT_UNIT_WIDTH });
    expect(result?.output, `import.unit line ${c.line}: ${c.description}`).toBe(c.expected);
  }
  // The engine is called with its own option name and one fixed file name.
  expect(engineControl.lastFileName).toBe('input.dart');
  expect(engineControl.lastConfig).toEqual({ line_width: 40 });
});

it('a dart_style fixture at 80 columns reproduces, so the line width option is honoured', () => {
  // The file has no width header, so dart_style runs it at its default page width of 80, which is the default here.
  expect(F.DEFAULT_WIDTH_UNIT_WIDTH).toBe(80);
  expect(F.DEFAULT_WIDTH_UNIT_CASES).toHaveLength(4);
  for (const c of F.DEFAULT_WIDTH_UNIT_CASES) {
    expect(formatDart(c.input)?.output, `0084.unit line ${c.line}`).toBe(c.expected);
    expect(formatDart(c.input, { lineWidth: 80 })?.output, `0084.unit line ${c.line} at 80`).toBe(c.expected);
  }
  expect(engineControl.lastConfig).toEqual({ line_width: 80 });

  // The width is read from the option: the first case's first line is over 80 characters, so it wraps at 80 as published
  // and stays on one line when the width is 120.
  const first = F.DEFAULT_WIDTH_UNIT_CASES[0];
  const firstLine = first?.input.split('\n')[0] ?? '';
  expect(firstLine.length).toBeGreaterThan(80);
  expect(firstLine.length).toBeLessThan(120);
  expect(formatDart(first?.input ?? '', { lineWidth: 120 })?.output.split('\n')[0]).toBe(firstLine);
  expect(formatDart(first?.input ?? '', { lineWidth: 80 })?.output.split('\n')[0]).not.toBe(firstLine);
});

it('a Dart syntax error names its line and column and gives no formatted code', () => {
  // Counted by hand: two lines, each ended by a line break, and a closing brace that never comes, so the formatter
  // looks for it at the end of the input, which is line 3, column 1.
  const missingBrace = failureOf('void main() {\n  print(1);\n');
  expect(missingBrace.message).toBe("Expected to find '}'.");
  expect([missingBrace.line, missingBrace.column]).toEqual([3, 1]);

  // The same input with CRLF and with lone CR line endings ends on the same line and column.
  for (const lineEnding of ['\r\n', '\r']) {
    const err = failureOf(`void main() {${lineEnding}  print(1);${lineEnding}`);
    expect([err.line, err.column], JSON.stringify(lineEnding)).toEqual([3, 1]);
  }

  // Counted by hand: line 3 is `  var = ;`, two spaces, `var` in columns 3 to 5, a space in column 6 and the `=`,
  // where a name must be, in column 7.
  const onLine3 = failureOf('void main() {\n  var x = 1;\n  var = ;\n}\n');
  expect(onLine3.message).toBe('Expected an identifier.');
  expect([onLine3.line, onLine3.column]).toEqual([3, 7]);

  // Whatever the engine prints around the position is never shown: only its first message line.
  expect(onLine3.message).not.toContain('\n');
  expect(onLine3.message).not.toContain('╷');
});

it('the column counts characters, so a non-ASCII character before the error counts once', () => {
  // Counted by hand: `void main() { var s = '` is 23 characters, the character inside the quotes is column 24, the
  // closing quote 25, the semicolon 26, a space 27, `print(` columns 28 to 33, a space 34, and the `}` where the
  // closing parenthesis must come is column 35. The engine counts UTF-16 code units, so the emoji (two of them) makes
  // it say 36; an accented letter is one unit and one character, and the plain letter is the twin.
  for (const [what, inside] of [
    ['a plain letter', 'e'],
    ['an accented letter', 'é'],
    ['an emoji', '😀'],
  ] as const) {
    const err = failureOf(`void main() { var s = '${inside}'; print( }\n`);
    expect(err.message, what).toBe("Expected to find ')'.");
    expect([err.line, err.column], what).toEqual([1, 35]);
  }
});

it('line width outside 1 to 1000 is refused naming the field', () => {
  const callsBefore = engineControl.count;
  for (const lineWidth of [0, 1001, -98765, 80.5, Number.NaN]) {
    const err = failureOf('var x = 1;\n', { lineWidth });
    expect(err.message, String(lineWidth)).toBe('Line width must be a whole number from 1 to 1000.');
    expect(err.line).toBeUndefined();
    expect(err.column).toBeUndefined();
  }
  expect(engineControl.count).toBe(callsBefore);

  // The ends of the range are accepted, and the default is 80.
  expect(formatDart('var x=1;\n', { lineWidth: 1 })?.output).toBe('var x = 1;\n');
  expect(formatDart('var x=1;\n', { lineWidth: 1000 })?.output).toBe('var x = 1;\n');
  formatDart('var x=1;\n');
  expect(engineControl.lastConfig).toEqual({ line_width: 80 });
});

it('bytes are compiled before the engine sees them, so it never asks for the built-in string helpers', () => {
  // The package compiles raw bytes with `builtins: ['js-string']`, and with those Node 22.23 and Node 24 trap on
  // every format ("illegal cast"). Handing the engine an already compiled module keeps its own string helpers.
  loadEngine(wasmBytes());
  expect(engineControl.lastInitArgument).toBeInstanceOf(WebAssembly.Module);
  expect(formatDart('var x=1;\n')?.output).toBe('var x = 1;\n');
});

it('blank or whitespace-only source is not sent to the engine and gives no result', () => {
  expect(formatDart('')).toBeNull();
  expect(formatDart('   \n\t \r\n')).toBeNull();
  expect(engineControl.count).toBe(0);
});

it('meta pins dart_fmt exactly and declares the dart_style and Dart SDK licence notices', () => {
  expect(toolMeta.dependencies).toEqual({ '@wasm-fmt/dart_fmt': '0.4.0' });
  const names = toolMeta.bundledData.map((b) => b.name);
  expect(names).toContain('dart_style formatter');
  expect(names).toContain('Dart SDK runtime and core libraries');
  for (const notice of toolMeta.bundledData) {
    expect(notice.licence).toBe('BSD-3-Clause');
    const noticePath = new URL(`../${notice.noticeFile}`, import.meta.url);
    expect(existsSync(noticePath)).toBe(true);
    expect(readFileSync(noticePath, 'utf8')).toContain('Redistribution and use in source and binary forms');
  }
  const first = (name: string) => {
    const notice = toolMeta.bundledData.find((b) => b.name === name);
    return readFileSync(new URL(`../${notice?.noticeFile ?? ''}`, import.meta.url), 'utf8').split('\n')[0];
  };
  expect(first('dart_style formatter')).toContain('Copyright 2014, the Dart project authors');
  expect(first('Dart SDK runtime and core libraries')).toContain('Copyright 2012, the Dart project authors');
});

it('an engine that cannot compile here gives a plain message naming WebAssembly garbage collection', () => {
  // A browser without WebAssembly garbage collection cannot compile this module: loading fails with a
  // WebAssembly.CompileError (the wrapper's own load code does not catch it). The wrapped engine entry raises that
  // error on demand, since the engine of this Node already has garbage collection.
  engineControl.initError = new WebAssembly.CompileError(
    'WebAssembly.Module(): invalid value type (garbage collection)',
  );
  let caught: unknown;
  try {
    loadEngine(wasmBytes());
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(DartFormatterError);
  const error = caught as DartFormatterError;
  expect(error.message).toBe('This browser cannot run the Dart formatter (it needs WebAssembly garbage collection).');
  expect(error.line).toBeUndefined();
  expect(error.column).toBeUndefined();

  // Any other failure to load is not hidden behind that message.
  engineControl.initError = new TypeError('not a buffer');
  expect(() => loadEngine(wasmBytes())).toThrow(TypeError);
  engineControl.initError = undefined;

  // With the failure gone, loading and formatting work again.
  loadEngine(wasmBytes());
  expect(formatDart('var x=1;\n')?.output).toBe('var x = 1;\n');
});

// This test comes last on purpose, and loads its own copy of the package: a stack overflow in a WebAssembly engine
// may leave an instance unusable (every later call can trap too), which is why each page run uses a new worker.
it('a 5000 term expression gives the too large or too deeply nested message with no position', async () => {
  vi.resetModules();
  const fresh = await import('../src/index');
  fresh.loadEngine(wasmBytes());
  const source = `var x = ${Array.from({ length: 5000 }, () => '1').join(' + ')};\n`;
  let caught: unknown;
  try {
    fresh.formatDart(source);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(fresh.DartFormatterError);
  const error = caught as DartFormatterError;
  expect(error.message).toBe('This input is too large or too deeply nested for the formatter.');
  expect(error.line).toBeUndefined();
  expect(error.column).toBeUndefined();
});
