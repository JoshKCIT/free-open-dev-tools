import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  loadEngine,
  formatPython,
  positionFromByteOffset,
  PythonFormatterError,
  meta as toolMeta,
  type FormatPythonOptions,
} from '../src/index';
import * as R from './fixtures/ruff-formatter/golden';

// The engine entry is wrapped only to COUNT calls, so a test can prove blank input never reaches the
// engine, and to make the next call fail on demand so the error mapping can be checked for failures that
// real input cannot produce deterministically. Otherwise the wrapper calls straight through; it is a spy,
// never an oracle.
const engineControl = vi.hoisted(() => ({ count: 0, failNext: undefined as undefined | { value: unknown } }));
vi.mock('@wasm-fmt/ruff_fmt/web', async (importOriginal) => {
  const real = await importOriginal<typeof import('@wasm-fmt/ruff_fmt/web')>();
  return {
    ...real,
    format: (...args: Parameters<typeof real.format>) => {
      engineControl.count += 1;
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
const wasmBytes = (): Uint8Array => new Uint8Array(readFileSync(require.resolve('@wasm-fmt/ruff_fmt/wasm')));

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeAll(() => {
  loadEngine(wasmBytes());
});

beforeEach(() => {
  engineControl.count = 0;
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  engineControl.failNext = undefined;
  for (const spy of consoleSpies) spy.mockRestore();
});

// Fixtures: crates/ruff_python_formatter/resources/test/fixtures/ruff/quote_style.py and
// crates/ruff_python_formatter/tests/snapshots/format@quote_style.py.snap at tag 0.15.20.
// URL: https://github.com/astral-sh/ruff/tree/0.15.20/crates/ruff_python_formatter (MIT, see ./fixtures/ruff-formatter/LICENSE)

it('Ruff 0.15.20 quote_style snapshot: the double quote output reproduces byte for byte', () => {
  // Output 2 of the snapshot is produced with quote-style = Double, line-width 88, indent-width 4, spaces: the page defaults.
  const result = formatPython(R.QUOTE_STYLE_INPUT);
  expect(result).not.toBeNull();
  expect(result?.output).toBe(R.QUOTE_STYLE_DOUBLE_OUTPUT);
  expect(result?.outputBytes).toBe(new TextEncoder().encode(R.QUOTE_STYLE_DOUBLE_OUTPUT).length);
  expect(result?.inputBytes).toBe(new TextEncoder().encode(R.QUOTE_STYLE_INPUT).length);
});

it('blank source gives no result and a line already formatted by Ruff comes back unchanged', () => {
  expect(formatPython('')).toBeNull();
  expect(formatPython('   \n\t\r\n')).toBeNull();
  expect(engineControl.count).toBe(0);

  // A line taken from the published double-quote output: already in Ruff's style, so formatting it alone changes nothing.
  const line = R.QUOTE_STYLE_DOUBLE_OUTPUT.split('\n').find((l) => l === 'rb"br double"');
  expect(line).toBe('rb"br double"');
  expect(formatPython(`${line}\n`)?.output).toBe(`${line}\n`);
  expect(engineControl.count).toBe(1);
});

it('loadEngine can be called twice and the engine prints nothing to the console', () => {
  expect(() => loadEngine(wasmBytes())).not.toThrow();
  expect(() => loadEngine(wasmBytes())).not.toThrow();
  expect(formatPython('x = 1\n')?.output).toBe('x = 1\n');
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

it('meta pins Ruff exactly and declares the Ruff licence notice', () => {
  expect(toolMeta.dependencies).toEqual({ '@wasm-fmt/ruff_fmt': '0.15.20' });
  const notices = toolMeta.bundledData;
  expect(notices).toHaveLength(1);
  const ruff = notices[0];
  expect(ruff?.name).toBe('Ruff 0.15.20 formatter');
  expect(ruff?.licence).toBe('MIT');
  expect(ruff?.attribution).toContain('Charles Marsh');
  const noticePath = new URL(`../${ruff?.noticeFile ?? 'missing'}`, import.meta.url);
  expect(existsSync(noticePath)).toBe(true);
  const text = readFileSync(noticePath, 'utf8');
  expect(text).toContain('MIT License');
  expect(text).toContain('Charles Marsh');
});

// Task 2: every option the page offers, against the snapshots Ruff publishes at the same tag.

const SPACE_4: Pick<FormatPythonOptions, 'indentStyle' | 'indentWidth'> = { indentStyle: 'space', indentWidth: 4 };

it('Ruff 0.15.20 quote_style snapshot: the single and preserve outputs reproduce byte for byte', () => {
  // Outputs 1 and 3 of format@quote_style.py.snap: quote-style = Single and quote-style = Preserve.
  expect(formatPython(R.QUOTE_STYLE_INPUT, { quoteStyle: 'single' })?.output).toBe(R.QUOTE_STYLE_SINGLE_OUTPUT);
  expect(formatPython(R.QUOTE_STYLE_INPUT, { quoteStyle: 'preserve' })?.output).toBe(R.QUOTE_STYLE_PRESERVE_OUTPUT);
});

it('Ruff 0.15.20 tab_width snapshot: indent widths 2, 4 and 8 reproduce byte for byte', () => {
  // format@tab_width.py.snap outputs 1 to 3: indent-style = space with indent-width 2, 4 and 8.
  expect(formatPython(R.TAB_WIDTH_INPUT, { indentStyle: 'space', indentWidth: 2 })?.output).toBe(
    R.TAB_WIDTH_WIDTH_2_OUTPUT,
  );
  expect(formatPython(R.TAB_WIDTH_INPUT, { indentStyle: 'space', indentWidth: 4 })?.output).toBe(
    R.TAB_WIDTH_WIDTH_4_OUTPUT,
  );
  expect(formatPython(R.TAB_WIDTH_INPUT, { indentStyle: 'space', indentWidth: 8 })?.output).toBe(
    R.TAB_WIDTH_WIDTH_8_OUTPUT,
  );
});

it('Ruff 0.15.20 snapshot with tab indentation reproduces byte for byte', () => {
  // format@docstring_tab_indentation.py.snap outputs 1 and 2: indent-style = tab with indent-width 4 and 8.
  expect(formatPython(R.DOCSTRING_TAB_INDENTATION_INPUT, { indentStyle: 'tab', indentWidth: 4 })?.output).toBe(
    R.DOCSTRING_TAB_INDENTATION_TAB_WIDTH_4_OUTPUT,
  );
  expect(formatPython(R.DOCSTRING_TAB_INDENTATION_INPUT, { indentStyle: 'tab', indentWidth: 8 })?.output).toBe(
    R.DOCSTRING_TAB_INDENTATION_TAB_WIDTH_8_OUTPUT,
  );
  // format@fmt_on_off__indent.py.snap: tab indentation at the default width, plus spaces at width 4 and 1.
  expect(formatPython(R.FMT_ON_OFF_INDENT_INPUT, { indentStyle: 'tab' })?.output).toBe(R.FMT_ON_OFF_INDENT_TAB_OUTPUT);
  expect(formatPython(R.FMT_ON_OFF_INDENT_INPUT, SPACE_4)?.output).toBe(R.FMT_ON_OFF_INDENT_SPACE_WIDTH_4_OUTPUT);
  expect(formatPython(R.FMT_ON_OFF_INDENT_INPUT, { indentStyle: 'space', indentWidth: 1 })?.output).toBe(
    R.FMT_ON_OFF_INDENT_SPACE_WIDTH_1_OUTPUT,
  );
  // The indent really is a tab character, not spaces.
  expect(R.DOCSTRING_TAB_INDENTATION_TAB_WIDTH_4_OUTPUT).toContain('\n\t');
});

it('Ruff 0.15.20 snapshot with a line width other than 88 reproduces byte for byte', () => {
  // format@fluent.py.snap output 1 (fluent.options.json sets line_width 8): line-width = 8.
  expect(formatPython(R.FLUENT_INPUT, { lineLength: 8 })?.output).toBe(R.FLUENT_LINE_WIDTH_8_OUTPUT);
  // The same source at the default width is different, so the option is what changed the result.
  expect(formatPython(R.FLUENT_INPUT)?.output).not.toBe(R.FLUENT_LINE_WIDTH_8_OUTPUT);
});

// Published cases the page cannot reproduce, listed by name with the reason, never silently dropped.
const NOT_REPRODUCED = [
  {
    name: 'format@skip_magic_trailing_comma.py.snap output 2 (magic-trailing-comma = Ignore)',
    reason: 'the page offers no magic trailing comma option, so only the default (respect) is reproduced',
  },
  {
    name: 'format@docstring_code_examples.py.snap and the preview, target version and source type snapshots',
    reason: 'the page offers no docstring code, preview, target version or source type option',
  },
];

it('Ruff 0.15.20 skip_magic_trailing_comma snapshot: the default respects the magic trailing comma', () => {
  // format@skip_magic_trailing_comma.py.snap output 1 (magic-trailing-comma = Respect), the engine default.
  expect(formatPython(R.SKIP_MAGIC_TRAILING_COMMA_INPUT)?.output).toBe(R.SKIP_MAGIC_TRAILING_COMMA_RESPECT_OUTPUT);
  expect(formatPython(R.SKIP_MAGIC_TRAILING_COMMA_INPUT)?.output).not.toBe(R.SKIP_MAGIC_TRAILING_COMMA_IGNORE_OUTPUT);
  expect(NOT_REPRODUCED.map((c) => c.name)).toHaveLength(2);
});

/** Runs formatPython and returns the PythonFormatterError it must throw. */
function failureOf(source: string, options: Partial<FormatPythonOptions> = {}): PythonFormatterError {
  try {
    formatPython(source, options);
  } catch (err) {
    expect(err).toBeInstanceOf(PythonFormatterError);
    return err as PythonFormatterError;
  }
  throw new Error('formatPython returned a result for source that must be refused');
}

it('a Python syntax error names its line and column from the byte range Ruff reports', () => {
  // Counted by hand. In 'def f(:' the letters d, e, f, a space and f are columns 1 to 5, the opening
  // parenthesis is column 6 and the colon column 7. Ruff reports byte range 6..7, so the colon is on line 1,
  // column 7.
  const first = failureOf('def f(:\n  pass\n');
  expect(first.message).toBe('Expected a parameter or the end of the parameter list');
  expect([first.line, first.column]).toEqual([1, 7]);

  // 'x = (1,' then a line break ends the file inside the bracket: the end of the input is line 2, column 1.
  const eof = failureOf('x = (1,\n');
  expect(eof.message).toBe('unexpected EOF while parsing');
  expect([eof.line, eof.column]).toEqual([2, 1]);

  // Nothing formatted comes back with a syntax error: formatPython throws, it never returns partial output.
  expect(() => formatPython('def f(:\n  pass\n')).toThrow(PythonFormatterError);
});

it('line and column count characters: an accented letter and an emoji count once and CRLF, CR and LF each end one line', () => {
  // Line 2 is 'y = é + )': y1 space2 =3 space4 é5 space6 +7 space8 )9, so the closing parenthesis is column 9.
  // é is two bytes in UTF-8, so Ruff's byte offset is one larger than the character offset.
  for (const eol of ['\n', '\r\n', '\r']) {
    const accented = failureOf(`x = 1${eol}y = é + )${eol}`);
    expect([accented.line, accented.column]).toEqual([2, 9]);
    const plain = failureOf(`x = 1${eol}y = e + )${eol}`);
    expect([plain.line, plain.column]).toEqual([2, 9]);
  }

  // Line 2 is 'y = "😀" + )': y1 space2 =3 space4 "5 😀6 "7 space8 +9 space10 )11. The emoji is four bytes
  // and counts as one character, so the parenthesis is column 11.
  const emoji = failureOf('x = 1\ny = "😀" + )\n');
  expect([emoji.line, emoji.column]).toEqual([2, 11]);

  // Lines end at CRLF, at a lone CR and at LF: 'a = 1' is line 1, 'b = 2' line 2, 'c = (' line 3, and the
  // end of the input after the last break is line 4, column 1.
  const mixed = failureOf('a = 1\r\nb = 2\rc = (\n');
  expect([mixed.line, mixed.column]).toEqual([4, 1]);

  // The conversion itself, on a byte offset: é is bytes 0 and 1, so offset 2 is the second character.
  expect(positionFromByteOffset('éa', 2)).toEqual({ line: 1, column: 2 });
  expect(positionFromByteOffset('a\r\nb', 3)).toEqual({ line: 2, column: 1 });
});

it('options outside their ranges are refused naming the field before the engine runs', () => {
  for (const lineLength of [0, 65536, -98765, 1.5, Number.NaN]) {
    const err = failureOf('x = 1\n', { lineLength });
    expect(err.message).toBe('Line length must be a whole number from 1 to 65535.');
    expect(err.line).toBeUndefined();
  }
  for (const indentWidth of [0, 256, -98765, 2.5]) {
    expect(failureOf('x = 1\n', { indentWidth }).message).toBe('Indent width must be a whole number from 1 to 255.');
  }
  // A value that is not one of the offered choices never reaches the engine either.
  expect(failureOf('x = 1\n', { quoteStyle: 'triple' as FormatPythonOptions['quoteStyle'] }).message).toBe(
    'Quote style must be double, single or preserve.',
  );
  expect(failureOf('x = 1\n', { indentStyle: 'mixed' as FormatPythonOptions['indentStyle'] }).message).toBe(
    'Indent with must be spaces or tabs.',
  );
  // Refused before the engine runs: not one of those calls reached it.
  expect(engineControl.count).toBe(0);

  // The bounds themselves are accepted.
  expect(formatPython('x = 1\n', { lineLength: 1, indentWidth: 1 })?.output).toBe('x = 1\n');
  expect(formatPython('x = 1\n', { lineLength: 65535, indentWidth: 255 })?.output).toBe('x = 1\n');
});

it('300 nested brackets give the too large or too deeply nested message with no position', () => {
  const err = failureOf('['.repeat(300));
  expect(err.message).toBe('This input is too large or too deeply nested for the formatter.');
  expect(err.line).toBeUndefined();
  expect(err.column).toBeUndefined();
});

it('engine failures that are not syntax errors get a plain message and no position', () => {
  const tooLarge = 'This input is too large or too deeply nested for the formatter.';
  const cases: [unknown, string][] = [
    [new RangeError('Maximum call stack size exceeded'), tooLarge],
    [new WebAssembly.RuntimeError('memory access out of bounds'), tooLarge],
    ['an engine message with no byte range', 'an engine message with no byte range'],
    [new Error('some other failure'), 'some other failure'],
    ['', 'The formatter failed on this input.'],
    [undefined, 'The formatter failed on this input.'],
  ];
  for (const [thrown, message] of cases) {
    engineControl.failNext = { value: thrown };
    const err = failureOf('x = 1\n');
    expect(err.message).toBe(message);
    expect(err.line).toBeUndefined();
    expect(err.column).toBeUndefined();
  }
});

// Probed: unlike shfmt and clang-format, the Ruff instance survives a too deeply nested input, so no "stopped" state
// is kept.
it('the engine still formats after an input that was too large or too deeply nested', () => {
  expect(failureOf('['.repeat(300)).message).toMatch(/too large or too deeply/);
  expect(formatPython('x   = 1\n')?.output).toBe('x = 1\n');
});
