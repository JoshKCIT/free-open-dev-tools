import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { loadEngine, formatGo, GoFormatterError, meta as toolMeta } from '../src/index';
import * as G from './fixtures/go-gofmt-testdata/golden';

// The engine entry is wrapped only to COUNT calls, so a test can prove blank input never reaches the
// engine, and to make the next call fail on demand so the error mapping can be checked for failures that
// real input cannot produce deterministically. Otherwise the wrapper calls straight through; it is a spy,
// never an oracle.
const engineControl = vi.hoisted(() => ({ count: 0, failNext: undefined as undefined | { value: unknown } }));
vi.mock('@wasm-fmt/gofmt/web', async (importOriginal) => {
  const real = await importOriginal<typeof import('@wasm-fmt/gofmt/web')>();
  return {
    ...real,
    format: (source: string) => {
      engineControl.count += 1;
      const failure = engineControl.failNext;
      if (failure) {
        engineControl.failNext = undefined;
        throw failure.value;
      }
      return real.format(source);
    },
  };
});

const require = createRequire(import.meta.url);
const wasmBytes = (): Buffer => readFileSync(require.resolve('@wasm-fmt/gofmt/wasm'));

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeAll(() => {
  loadEngine(wasmBytes());
});

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  engineControl.failNext = undefined;
  for (const spy of consoleSpies) spy.mockRestore();
});

/** Runs formatGo and returns the GoFormatterError it must throw. */
function failureOf(source: string): GoFormatterError {
  try {
    formatGo(source);
  } catch (err) {
    expect(err).toBeInstanceOf(GoFormatterError);
    return err as GoFormatterError;
  }
  throw new Error('formatGo returned a result for source that must be refused');
}

// Fixtures: src/cmd/gofmt/testdata/<name>.input and <name>.golden at tag go1.25.5.
// URL: https://github.com/golang/go/tree/go1.25.5/src/cmd/gofmt/testdata
// Licence: BSD-3-Clause (vendored beside the fixture module as LICENSE).
// Every fixture of that directory that needs no command-line flag. The stdin fixtures are named for the
// way gofmt's own test feeds them; their goldens are the same flag-free output.
const FLAG_FREE: readonly (readonly [name: string, input: string, golden: string])[] = [
  ['comments', G.COMMENTS_INPUT, G.COMMENTS_GOLDEN],
  ['crlf', G.CRLF_INPUT, G.CRLF_GOLDEN],
  ['go2numbers', G.GO2NUMBERS_INPUT, G.GO2NUMBERS_GOLDEN],
  ['import', G.IMPORT_INPUT, G.IMPORT_GOLDEN],
  ['issue28082', G.ISSUE28082_INPUT, G.ISSUE28082_GOLDEN],
  ['stdin1', G.STDIN1_INPUT, G.STDIN1_GOLDEN],
  ['stdin2', G.STDIN2_INPUT, G.STDIN2_GOLDEN],
  ['stdin3', G.STDIN3_INPUT, G.STDIN3_GOLDEN],
  ['stdin4', G.STDIN4_INPUT, G.STDIN4_GOLDEN],
  ['stdin5', G.STDIN5_INPUT, G.STDIN5_GOLDEN],
  ['stdin6', G.STDIN6_INPUT, G.STDIN6_GOLDEN],
  ['stdin7', G.STDIN7_INPUT, G.STDIN7_GOLDEN],
  ['tabs', G.TABS_INPUT, G.TABS_GOLDEN],
  ['typealias', G.TYPEALIAS_INPUT, G.TYPEALIAS_GOLDEN],
  ['typeparams', G.TYPEPARAMS_INPUT, G.TYPEPARAMS_GOLDEN],
  ['typeswitch', G.TYPESWITCH_INPUT, G.TYPESWITCH_GOLDEN],
];

// Fixtures of that directory that the package does not reproduce, by name and reason (never a silent drop):
// every rewrite*.input needs gofmt -r, and composites, emptydecl, ranges and slices1 need gofmt -s. Neither
// flag exists in the engine, so those goldens are the output of an operation this tool does not offer.
const NOT_REPRODUCED: readonly (readonly [name: string, reason: string])[] = [
  ['composites', 'needs gofmt -s (simplify)'],
  ['emptydecl', 'needs gofmt -s (simplify)'],
  ['ranges', 'needs gofmt -s (simplify)'],
  ['slices1', 'needs gofmt -s (simplify); used below to prove that -s is NOT applied'],
  ['rewrite1 to rewrite10', 'needs gofmt -r (rewrite rule)'],
];

// Fixture: src/cmd/gofmt/testdata/import.input and import.golden at tag go1.25.5.
// URL: https://github.com/golang/go/tree/go1.25.5/src/cmd/gofmt/testdata
// Licence: BSD-3-Clause (vendored beside the fixture module as LICENSE).
it('gofmt testdata import golden: the import fixture formats byte for byte as gofmt does', () => {
  const result = formatGo(G.IMPORT_INPUT);
  expect(result).not.toBeNull();
  expect(result!.output).toBe(G.IMPORT_GOLDEN);
  // The first import block of the golden is the sorted block named by the fixture itself.
  expect(result!.output).toContain('import (\n\t"errors"\n\t"fmt"\n\t"io"\n\t"log"\n\t"math"\n)\n');
  expect(result!.inputBytes).toBe(new TextEncoder().encode(G.IMPORT_INPUT).length);
  expect(result!.outputBytes).toBe(new TextEncoder().encode(G.IMPORT_GOLDEN).length);
});

it('blank or whitespace-only source is not sent to the engine and gives no result', () => {
  const before = engineControl.count;
  expect(formatGo('')).toBeNull();
  expect(formatGo('   ')).toBeNull();
  expect(formatGo('\n\t \r\n')).toBeNull();
  expect(engineControl.count).toBe(before);
  // Real source does reach the engine, so the counter itself is proven to work.
  expect(formatGo('package p\n')).not.toBeNull();
  expect(engineControl.count).toBe(before + 1);
});

it('loadEngine can be called twice and the engine prints nothing to the console', () => {
  expect(() => loadEngine(wasmBytes())).not.toThrow();
  expect(() => loadEngine(wasmBytes())).not.toThrow();
  formatGo('package main\n\nfunc main() {}\n');
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

it('meta pins the gofmt engine exactly and declares the Go and TinyGo licence notices', () => {
  expect(toolMeta.id).toBe('go-formatter');
  expect(toolMeta.dependencies).toEqual({ '@wasm-fmt/gofmt': '0.7.3' });
  const names = toolMeta.bundledData.map((entry) => entry.name);
  expect(names).toEqual(['Go standard library 1.25.5', 'TinyGo runtime']);
  for (const entry of toolMeta.bundledData) {
    expect(entry.licence).toBe('BSD-3-Clause');
    const noticeUrl = new URL(`../${entry.noticeFile}`, import.meta.url);
    expect(existsSync(noticeUrl)).toBe(true);
    expect(readFileSync(noticeUrl, 'utf8').trim().length).toBeGreaterThan(0);
  }
});

it('gofmt testdata: every flag-free golden file of Go 1.25.5 formats byte for byte', () => {
  expect(FLAG_FREE.length).toBe(16);
  // The fixtures this package leaves out are listed above with their reasons.
  expect(NOT_REPRODUCED.length).toBe(5);
  for (const [name, input, golden] of FLAG_FREE) {
    const result = formatGo(input);
    expect(result, `${name}.input gave no result`).not.toBeNull();
    expect(result!.output, `${name}.golden`).toBe(golden);
  }
  // The CRLF fixture really carries carriage returns in, and none come out (published as issue 3961).
  expect(G.CRLF_INPUT).toContain('\r\n');
  expect(G.CRLF_GOLDEN).not.toContain('\r');
});

it('a gofmt golden output formats to itself, so a second run changes nothing', () => {
  for (const [name, , golden] of FLAG_FREE) {
    const again = formatGo(golden);
    expect(again, `${name}.golden gave no result`).not.toBeNull();
    expect(again!.output, `${name}.golden formatted again`).toBe(golden);
  }
});

// Fixture: src/cmd/gofmt/testdata/slices1.input and slices1.golden at tag go1.25.5 (first line //gofmt -s).
// Its golden is the output of gofmt -s, which rewrites a[2:len(a)] to a[2:]. The engine has no -s, so the
// redundant form in the input must survive and the golden must NOT be reproduced.
it('a gofmt -s fixture is formatted without simplification, as the limits state', () => {
  expect(G.SLICES1_INPUT.split('\n')[0]).toBe('//gofmt -s');
  expect(G.SLICES1_INPUT).toContain('_ = a[2:len(a)]');
  expect(G.SLICES1_GOLDEN).toContain('_ = a[2:]');
  expect(G.SLICES1_GOLDEN).not.toContain('a[2:len(a)]');
  const result = formatGo(G.SLICES1_INPUT);
  expect(result).not.toBeNull();
  expect(result!.output).toContain('_ = a[2:len(a)]');
  expect(result!.output).not.toContain('_ = a[2:]\n');
  expect(result!.output).not.toBe(G.SLICES1_GOLDEN);
});

// Positions below are counted by hand from each input, never copied from the engine's output.
it('a Go syntax error names its line and column and gives no formatted code', () => {
  // Line 1 package main, line 2 blank, line 3 `func main() { x := }`: the closing brace where an operand must
  // follow := . Columns: f=1 u=2 n=3 c=4 space=5 m=6 a=7 i=8 n=9 (=10 )=11 space=12 {=13 space=14 x=15
  // space=16 :=17 =18 space=19 }=20.
  const error = failureOf('package main\n\nfunc main() { x := }\n');
  expect(error.name).toBe('GoFormatterError');
  expect(error.line).toBe(3);
  expect(error.column).toBe(20);
  expect(error.message).toBe("expected operand, found '}'");

  // The same fault on its own line: line 5 is the lone closing brace, column 1.
  const multiLine = failureOf('package main\n\nfunc main() {\n\tx :=\n}\n');
  expect(multiLine.line).toBe(5);
  expect(multiLine.column).toBe(1);

  // Carriage returns before the newlines do not move the position: still line 3, column 20.
  const crlf = failureOf('package main\r\n\r\nfunc main() { x := }\r\n');
  expect(crlf.line).toBe(3);
  expect(crlf.column).toBe(20);

  // A refused input never yields output: the call throws instead of returning anything.
  expect(() => formatGo('package main\n\nfunc main() { x := }\n')).toThrow(GoFormatterError);
});

it('the column counts characters, so a non-ASCII letter before the error counts once', () => {
  // `func main() { é := }`: é is one character (two bytes). Same layout as the ASCII line above, so the
  // closing brace is character column 20; gofmt itself counts bytes and would say 21.
  const accented = failureOf('package main\n\nfunc main() { é := }\n');
  const plain = failureOf('package main\n\nfunc main() { e := }\n');
  expect(plain.column).toBe(20);
  expect(accented.line).toBe(3);
  expect(accented.column).toBe(20);

  // A character outside the basic plane (four bytes, two UTF-16 units) still counts once. In
  // `func main() { s := "<grin>" + }` the 14 characters of `func main() { ` come first, then s=15 space=16
  // :=17,18 space=19 "=20 emoji=21 "=22 space=23 +=24 space=25 }=26.
  const astral = failureOf('package main\n\nfunc main() { s := "\u{1F600}" + }\n');
  expect(astral.line).toBe(3);
  expect(astral.column).toBe(26);
});

// A 20000 term addition chain nests 20000 levels deep in the parse tree; the engine overflows its stack.
// This runs last among the tests that use the real engine, because a trapped instance is not reused in Node
// (in the browser every run gets a new worker, so nothing is reused there either).
it('a 20000 term expression gives the too large or too deeply nested message with no position', () => {
  const source = `package main\n\nvar x = 1${' + 1'.repeat(20000)}\n`;
  const error = failureOf(source);
  expect(error.message).toBe('This input is too large or too deeply nested for the formatter.');
  expect(error.line).toBeUndefined();
  expect(error.column).toBeUndefined();
});

it('an engine failure that is not a syntax error gives a plain message and never partial output', () => {
  const fail = (value: unknown): GoFormatterError => {
    engineControl.failNext = { value };
    return failureOf('package main\n');
  };

  const plain = fail(new Error('engine said something unusual'));
  expect(plain.message).toBe('engine said something unusual');
  expect(plain.line).toBeUndefined();
  expect(plain.column).toBeUndefined();

  expect(fail('a thrown string').message).toBe('a thrown string');
  expect(fail(new Error('')).message).toBe('The formatter failed on this input.');
  expect(fail({}).message).toBe('The formatter failed on this input.');
  expect(fail(undefined).message).toBe('The formatter failed on this input.');

  // A stack overflow or a WebAssembly trap is the too large or too deeply nested message.
  const tooDeep = 'This input is too large or too deeply nested for the formatter.';
  expect(fail(new RangeError('Maximum call stack size exceeded')).message).toBe(tooDeep);
  expect(fail(new WebAssembly.RuntimeError('memory access out of bounds')).message).toBe(tooDeep);

  // A message that merely looks like a position but is not at the start of the text is not a position.
  const lookalike = fail(new Error('see 3:4: elsewhere'));
  expect(lookalike.line).toBeUndefined();
  expect(lookalike.column).toBeUndefined();

  // After a failure the next call formats normally: nothing is left over.
  expect(formatGo('package main\nfunc main(){}\n')!.output).toBe('package main\n\nfunc main() {}\n');
});

// Probed: unlike shfmt and clang-format, the gofmt instance survives a stack overflow, so no "stopped" state is kept.
it('the engine still formats after an input that was too large or too deeply nested', () => {
  expect(failureOf(`package main\n\nvar x = 1${' + 1'.repeat(20000)}\n`).message).toMatch(/too large or too deeply/);
  expect(formatGo('package main\nvar x=1\n')?.output).toBe('package main\n\nvar x = 1\n');
});
