import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  loadEngine,
  formatShell,
  ShellFormatterError,
  SHELL_DIALECTS,
  meta as toolMeta,
  type FormatShellOptions,
} from '../src/index';
import * as F from './fixtures/mvdan-sh/golden';

// The engine entry is wrapped only to RECORD what it is called with and COUNT calls, so a test can prove blank
// input and refused options never reach the engine and that the dialect reaches it as a file name, and to make
// the next call fail on demand so the error mapping can be checked for failures real input cannot produce
// deterministically. Otherwise the wrapper calls straight through; it is a spy, never an oracle.
const engineControl = vi.hoisted(() => ({
  count: 0,
  lastPath: undefined as undefined | string,
  lastOptions: undefined as undefined | Record<string, unknown>,
  failNext: undefined as undefined | { value: unknown },
}));
vi.mock('@wasm-fmt/shfmt/web', async (importOriginal) => {
  const real = await importOriginal<typeof import('@wasm-fmt/shfmt/web')>();
  return {
    ...real,
    format: (...args: Parameters<typeof real.format>) => {
      engineControl.count += 1;
      engineControl.lastPath = args[1];
      engineControl.lastOptions = args[2] as Record<string, unknown> | undefined;
      const failure = engineControl.failNext;
      if (failure) {
        engineControl.failNext = undefined;
        throw failure.value;
      }
      return real.format(...args);
    },
  };
});

const require = createRequire(import.meta.url);
const wasmBytes = (): Uint8Array => new Uint8Array(readFileSync(require.resolve('@wasm-fmt/shfmt/wasm')));

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeAll(() => {
  loadEngine(wasmBytes());
});

beforeEach(() => {
  engineControl.count = 0;
  engineControl.lastPath = undefined;
  engineControl.lastOptions = undefined;
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  engineControl.failNext = undefined;
  for (const spy of consoleSpies) spy.mockRestore();
});

/** Runs formatShell and returns the ShellFormatterError it must throw. */
function failureOf(source: string, options: Partial<FormatShellOptions> = {}): ShellFormatterError {
  try {
    formatShell(source, options);
  } catch (err) {
    expect(err).toBeInstanceOf(ShellFormatterError);
    return err as ShellFormatterError;
  }
  throw new Error('formatShell returned a result for source that must be refused');
}

// Fixtures: cmd/shfmt/testdata/script/flags.txtar at tag v3.13.1.
// URL: https://github.com/mvdan/sh/blob/v3.13.1/cmd/shfmt/testdata/script/flags.txtar (BSD-3-Clause, see ./fixtures/mvdan-sh/LICENSE)

it('shfmt 3.13.1 flags fixture: the default output indents with tabs and indent 2 matches its golden', () => {
  // The default (indent 0, tabs) is the published keep-padding golden with its one padding line collapsed: the file
  // has no golden for the default alone, and every other golden shows the line as `keep padding`.
  expect(F.FLAGS_KEEP_PADDING_GOLDEN).toContain('keep  padding');
  const defaults = formatShell(F.FLAGS_INPUT);
  expect(defaults?.output).toBe(F.FLAGS_KEEP_PADDING_GOLDEN.replace('keep  padding', 'keep padding'));
  expect(defaults?.output).toContain('\n\tbar &&\n\t\tbaz\n');
  expect(defaults?.inputBytes).toBe(new TextEncoder().encode(F.FLAGS_INPUT).length);
  expect(defaults?.outputBytes).toBe(new TextEncoder().encode(defaults?.output ?? '').length);

  // shfmt -i 2: the published indent golden, byte for byte.
  expect(formatShell(F.FLAGS_INPUT, { indent: 2 })?.output).toBe(F.FLAGS_INDENT_GOLDEN);
});

it('bash and mksh are chosen by the dialect: a coprocess formats as mksh and is refused as bash', () => {
  // `coprocess |&` is valid only in mksh (flags.txtar section input-mksh).
  expect(formatShell(F.INPUT_MKSH, { dialect: 'mksh' })?.output).toBe(F.INPUT_MKSH);

  // Counted by hand: coprocess is nine letters (columns 1 to 9), a space is column 10, and the `|&` that has no
  // statement to follow starts at column 11 of line 1.
  const refused = failureOf(F.INPUT_MKSH, { dialect: 'bash' });
  expect(refused.message).toBe('`|&` must be followed by a statement');
  expect([refused.line, refused.column]).toEqual([1, 11]);

  // The same coprocess after a first line naming mksh (section input-mksh-shebang): the POSIX sh choice only passes
  // a .sh file name, so the engine reads the first line and formats it as mksh, while bash is refused on line 2.
  expect(formatShell(F.INPUT_MKSH_SHEBANG, { dialect: 'posix' })?.output).toBe(F.INPUT_MKSH_SHEBANG);
  const refusedAfterShebang = failureOf(F.INPUT_MKSH_SHEBANG, { dialect: 'bash' });
  expect([refusedAfterShebang.line, refusedAfterShebang.column]).toEqual([2, 11]);

  // The dialect reaches the engine as a file name, and an indent of 0 sends no indent at all (tabs).
  expect(SHELL_DIALECTS).toEqual(['posix', 'bash', 'mksh']);
  for (const [dialect, fileName] of [
    ['posix', 'input.sh'],
    ['bash', 'input.bash'],
    ['mksh', 'input.mksh'],
  ] as const) {
    formatShell('echo hi\n', { dialect });
    expect(engineControl.lastPath).toBe(fileName);
    expect(engineControl.lastOptions).toEqual({});
  }
  formatShell('echo hi\n', { indent: 4 });
  expect(engineControl.lastOptions).toEqual({ indent: 4 });
});

it('a POSIX-valid script formats identically under POSIX sh, bash and mksh', () => {
  const scripts = [
    F.FLAGS_INPUT,
    'if [ -f x ];then echo yes;else echo no;fi\nwhile read l;do echo "$l";done <file\n',
    '#!/bin/sh\nfor f in a b c\ndo\necho "$f"\ndone\n',
  ];
  for (const script of scripts) {
    for (const indent of [0, 2, 4]) {
      const [posix, bash, mksh] = SHELL_DIALECTS.map((dialect) => formatShell(script, { dialect, indent })?.output);
      expect(posix).toBeDefined();
      expect(bash).toBe(posix);
      expect(mksh).toBe(posix);
    }
  }
  // And the POSIX sh choice still prints the published indent golden.
  expect(formatShell(F.FLAGS_INPUT, { dialect: 'posix', indent: 2 })?.output).toBe(F.FLAGS_INDENT_GOLDEN);
});

it('the POSIX sh choice formats bash-only syntax without refusing it, as the limits state', () => {
  // Upstream refuses these two scripts in POSIX mode (flags.txtar: parsed as posix via -ln=auto); this engine build
  // cannot parse in POSIX mode, so they are formatted, and the limits say so.
  expect(formatShell(F.INPUT_BASH_ARRAYS, { dialect: 'posix' })?.output).toContain('foo=(bar)');
  expect(formatShell(F.INPUT_BASH_EXTGLOBS, { dialect: 'posix' })?.output).toBe(F.INPUT_BASH_EXTGLOBS);
  expect(formatShell('[[ -n $x ]] && echo "$x"\ndiff <(ls a) <(ls b)\n', { dialect: 'posix' })?.output).toBe(
    '[[ -n $x ]] && echo "$x"\ndiff <(ls a) <(ls b)\n',
  );

  const limits = toolMeta.limits.join('\n');
  expect(limits).toContain('POSIX');
  expect(limits).toContain('not refused');
});

it('a shell syntax error names its line and column and gives no formatted code', () => {
  // Counted by hand. The unfinished if starts the script: the keyword `if` is line 1, column 1.
  const noFi = failureOf('if true; then\n  echo hi\n');
  expect(noFi.message).toBe('`if` statement must end with `fi`');
  expect([noFi.line, noFi.column]).toEqual([1, 1]);

  // A line before it moves the same error to line 2, column 1, also with CRLF line endings.
  for (const eol of ['\n', '\r\n']) {
    const second = failureOf(`echo ok${eol}if true; then${eol}  echo hi${eol}`);
    expect([second.line, second.column]).toEqual([2, 1]);
  }

  // `if true; then` with nothing after it: i1 f2 space3 t4 r5 u6 e7 ;8 space9, so `then` is column 10.
  const noBody = failureOf('if true; then');
  expect(noBody.message).toBe('`then` must be followed by a statement list');
  expect([noBody.line, noBody.column]).toEqual([1, 10]);

  // Nothing formatted comes back with a syntax error: formatShell throws, it never returns partial output.
  expect(() => formatShell('if true; then\n  echo hi\n')).toThrow(ShellFormatterError);
});

it('the column counts characters, so a non-ASCII character before the error counts once', () => {
  // `echo "e"; if true; then`: e1 c2 h3 o4 space5 "6 e7 "8 ;9 space10 i11, so the unfinished if is column 11.
  const plain = failureOf('echo "e"; if true; then\n  echo hi\n');
  expect([plain.line, plain.column]).toEqual([1, 11]);

  // With é in place of e the engine says byte column 12 (é is two bytes); the visitor sees column 11.
  const accented = failureOf('echo "é"; if true; then\n  echo hi\n');
  expect([accented.line, accented.column]).toEqual([1, 11]);

  // A four-byte emoji is one character: the engine says byte column 14, the visitor sees column 11.
  const emoji = failureOf('echo "😀"; if true; then\n  echo hi\n');
  expect([emoji.line, emoji.column]).toEqual([1, 11]);
});

it('indent outside 0 to 16 is refused naming the field', () => {
  for (const indent of [-1, 17, -98765, 1.5, Number.NaN]) {
    const err = failureOf('echo hi\n', { indent });
    expect(err.message).toBe('Indent must be a whole number from 0 to 16.');
    expect(err.line).toBeUndefined();
  }
  expect(failureOf('echo hi\n', { dialect: 'zsh' as FormatShellOptions['dialect'] }).message).toBe(
    'Dialect must be POSIX sh, bash or mksh.',
  );
  // Refused before the engine runs: not one of those calls reached it.
  expect(engineControl.count).toBe(0);

  // The bounds themselves are accepted.
  expect(formatShell('echo hi\n', { indent: 0 })?.output).toBe('echo hi\n');
  expect(formatShell('echo hi\n', { indent: 16 })?.output).toBe('echo hi\n');
});

it('blank or whitespace-only source is not sent to the engine and gives no result', () => {
  expect(formatShell('')).toBeNull();
  expect(formatShell('   \n\t\r\n')).toBeNull();
  expect(engineControl.count).toBe(0);
});

it('meta pins shfmt exactly and declares the sh and TinyGo licence notices', () => {
  expect(toolMeta.dependencies).toEqual({ '@wasm-fmt/shfmt': '0.2.7' });
  const names = toolMeta.bundledData.map((b) => b.name);
  expect(names).toEqual(['mvdan/sh 3.13.1', 'TinyGo runtime']);
  for (const notice of toolMeta.bundledData) {
    expect(notice.licence).toBe('BSD-3-Clause');
    const noticePath = new URL(`../${notice.noticeFile}`, import.meta.url);
    expect(existsSync(noticePath)).toBe(true);
    expect(readFileSync(noticePath, 'utf8')).toContain('Redistribution and use in source and binary forms');
  }
  expect(toolMeta.bundledData[0]?.attribution).toContain('Daniel Mart');
});

it('engine failures that are not syntax errors get a plain message and no position', () => {
  const tooLarge = 'This input is too large or too deeply nested for the formatter.';
  const cases: [unknown, string][] = [
    [new RangeError('Maximum call stack size exceeded'), tooLarge],
    [new WebAssembly.RuntimeError('memory access out of bounds'), tooLarge],
    [new Error('some other failure'), 'some other failure'],
    ['a plain string failure', 'a plain string failure'],
    ['', 'The formatter failed on this input.'],
    [undefined, 'The formatter failed on this input.'],
  ];
  for (const [thrown, message] of cases) {
    engineControl.failNext = { value: thrown };
    const err = failureOf('echo hi\n');
    expect(err.message).toBe(message);
    expect(err.line).toBeUndefined();
    expect(err.column).toBeUndefined();
  }
});

// An option left undefined means "not chosen": it must not override the default and fail with a range message.
it('options set to undefined use their defaults', () => {
  const none = formatShell('if true; then\n  echo hi\nfi\n');
  expect(formatShell('if true; then\n  echo hi\nfi\n', { indent: undefined, dialect: undefined })).toEqual(none);
  expect(none?.output).toBe('if true; then\n\techo hi\nfi\n');
});

// The tests from here on trap the real engine, which every later test in this file would then share (an installed
// package is not reloaded by vi.resetModules), so they stay last.
// This test comes last on purpose, and loads its own copy of the package: a WebAssembly trap leaves the engine
// instance unusable (every later call traps too), which is why each page run uses a new worker.
it('2000 nested command substitutions give the too large or too deeply nested message with no position', async () => {
  vi.resetModules();
  const fresh = await import('../src/index');
  fresh.loadEngine(wasmBytes());
  const source = `echo ${'$('.repeat(2000)}x${')'.repeat(2000)}\n`;
  let caught: unknown;
  try {
    fresh.formatShell(source);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(fresh.ShellFormatterError);
  const error = caught as ShellFormatterError;
  expect(error.message).toBe('This input is too large or too deeply nested for the formatter.');
  expect(error.line).toBeUndefined();
  expect(error.column).toBeUndefined();
});

// One trap leaves the shfmt instance broken for good (every later call traps too, even on a valid script), and the
// package offers no way to start a new instance. So the folder remembers the trap and says so, instead of blaming
// each later input for being too large.
it('after a too large input every later call says the engine stopped and must be loaded again', async () => {
  vi.resetModules();
  const fresh = await import('../src/index');
  fresh.loadEngine(wasmBytes());
  expect(() => fresh.formatShell(`echo ${'$('.repeat(2000)}x${')'.repeat(2000)}\n`)).toThrow(
    'This input is too large or too deeply nested for the formatter.',
  );
  const afterTrap = engineControl.count;

  let caught: unknown;
  try {
    fresh.formatShell('echo   hi\n');
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(fresh.ShellFormatterError);
  const error = caught as ShellFormatterError;
  expect(error.message).toMatch(/stopped after an earlier input that was too large or too deeply nested/);
  expect(error.message).toMatch(/new worker or process/);
  expect(error.message).not.toMatch(/^This input is too large/);
  expect(error.line).toBeUndefined();
  // The stopped engine is not called again, and blank input and refused options behave as before.
  expect(engineControl.count).toBe(afterTrap);
  expect(fresh.formatShell('  \n')).toBeNull();
  expect(() => fresh.formatShell('echo hi\n', { indent: 99 })).toThrow('Indent must be a whole number from 0 to 16.');
});

it('the limits say the engine must be loaded again after a too large input', () => {
  expect(toolMeta.limits.some((l) => l.includes('new worker or process'))).toBe(true);
});
