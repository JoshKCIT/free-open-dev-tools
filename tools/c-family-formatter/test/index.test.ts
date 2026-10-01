import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  loadEngine,
  formatCFamily,
  styleFor,
  CFamilyFormatterError,
  C_FAMILY_LANGUAGES,
  C_FAMILY_PRESETS,
  meta as toolMeta,
  type CFamilyLanguage,
  type CFamilyPreset,
  type FormatCFamilyOptions,
} from '../src/index';
import * as F from './fixtures/llvm-clang-format/golden';

// The engine entry is wrapped only to COUNT calls and to RECORD the file name and style it is called with, so a
// test can prove blank input never reaches the engine and that the style string is exactly what the package
// builds. Otherwise the wrapper calls straight through; it is a spy, never an oracle.
const engineControl = vi.hoisted(() => ({
  count: 0,
  lastFileName: undefined as undefined | string,
  lastStyle: undefined as undefined | string,
}));
vi.mock('@wasm-fmt/clang-format/web', async (importOriginal) => {
  const real = await importOriginal<typeof import('@wasm-fmt/clang-format/web')>();
  return {
    ...real,
    format: (...args: Parameters<typeof real.format>) => {
      engineControl.count += 1;
      engineControl.lastFileName = args[1];
      engineControl.lastStyle = args[2];
      return real.format(...args);
    },
  };
});

const require = createRequire(import.meta.url);
const wasmBytes = (): Uint8Array => new Uint8Array(readFileSync(require.resolve('@wasm-fmt/clang-format/wasm')));

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeAll(() => {
  loadEngine(wasmBytes());
});

beforeEach(() => {
  engineControl.count = 0;
  engineControl.lastFileName = undefined;
  engineControl.lastStyle = undefined;
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

// Fixture: clang/docs/ClangFormatStyleOptions.rst at tag llvmorg-23.1.1, section IndentWidth.
// URL: https://github.com/llvm/llvm-project/blob/llvmorg-23.1.1/clang/docs/ClangFormatStyleOptions.rst
// Licence: Apache-2.0 WITH LLVM-exception (see ./fixtures/llvm-clang-format/LICENSE)

it('clang-format 23.1.1 documentation: the IndentWidth 3 example reproduces exactly', () => {
  const result = formatCFamily(F.INDENT_WIDTH_DOC_INPUT, { language: 'cpp', preset: 'LLVM', indentWidth: 3 });
  expect(result?.output).toBe(F.INDENT_WIDTH_DOC_OUTPUT);
  expect(result?.inputBytes).toBe(new TextEncoder().encode(F.INDENT_WIDTH_DOC_INPUT).length);
  expect(result?.outputBytes).toBe(new TextEncoder().encode(F.INDENT_WIDTH_DOC_OUTPUT).length);

  // The page's defaults (C++, LLVM, no indent width) use the preset's own width, which is two.
  expect(formatCFamily(F.INDENT_WIDTH_DOC_INPUT)?.output).toContain('\n  someFunction();\n');
});

it('the style string is a preset name alone or BasedOnStyle with an IndentWidth', () => {
  expect(styleFor('LLVM')).toBe('LLVM');
  expect(styleFor('GNU', undefined)).toBe('GNU');
  expect(styleFor('Google', 4)).toBe('{BasedOnStyle: Google, IndentWidth: 4}');

  // The same strings are what reaches the engine, with the language's file name.
  formatCFamily('int x;\n', { language: 'cpp', preset: 'Mozilla' });
  expect(engineControl.lastStyle).toBe('Mozilla');
  expect(engineControl.lastFileName).toBe('input.cpp');
  formatCFamily('int x;\n', { language: 'cpp', preset: 'Mozilla', indentWidth: 8 });
  expect(engineControl.lastStyle).toBe('{BasedOnStyle: Mozilla, IndentWidth: 8}');
});

it('blank or whitespace-only source is not sent to the engine and gives no result', () => {
  expect(formatCFamily('')).toBeNull();
  expect(formatCFamily('   \n\t \r\n')).toBeNull();
  expect(engineControl.count).toBe(0);
});

it('loadEngine can be called twice and the engine prints nothing to the console', async () => {
  // Loading again must not throw, and formatting afterwards still works.
  expect(() => loadEngine(wasmBytes())).not.toThrow();
  expect(formatCFamily(F.INDENT_WIDTH_DOC_INPUT, { indentWidth: 3 })?.output).toBe(F.INDENT_WIDTH_DOC_OUTPUT);

  // A first load in a fresh copy of the package, with the console spies already in place, prints nothing either.
  vi.resetModules();
  const fresh = await import('../src/index');
  fresh.loadEngine(wasmBytes());
  expect(fresh.formatCFamily(F.INDENT_WIDTH_DOC_INPUT, { indentWidth: 3 })?.output).toBe(F.INDENT_WIDTH_DOC_OUTPUT);

  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

it('meta pins clang-format exactly and declares the LLVM licence notice', () => {
  expect(toolMeta.dependencies).toEqual({ '@wasm-fmt/clang-format': '23.1.1' });
  expect(toolMeta.bundledData.map((b) => b.name)).toEqual(['LLVM clang-format 23.1.1']);
  const notice = toolMeta.bundledData[0];
  expect(notice?.licence).toBe('Apache-2.0 WITH LLVM-exception');
  const noticePath = new URL(`../${notice?.noticeFile ?? ''}`, import.meta.url);
  expect(existsSync(noticePath)).toBe(true);
  const text = readFileSync(noticePath, 'utf8');
  expect(text).toContain('The LLVM Project is under the Apache License v2.0 with LLVM Exceptions');
  expect(text).toContain('LLVM Exceptions to the Apache 2.0 License');
});

// Fixtures for the tests below: clang/unittests/Format/*.cpp and clang/lib/Format/Format.cpp at tag llvmorg-23.1.1
// (https://github.com/llvm/llvm-project/tree/llvmorg-23.1.1/clang, Apache-2.0 WITH LLVM-exception, see
// ./fixtures/llvm-clang-format/LICENSE and UPSTREAM.md).

const LANGUAGE_LABELS: Record<CFamilyLanguage, string> = {
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  java: 'Java',
  objc: 'Objective-C',
  proto: 'Protocol Buffers',
};

/** Runs formatCFamily and returns the CFamilyFormatterError it must throw. */
function failureOf(source: string, options: Partial<FormatCFamilyOptions>): CFamilyFormatterError {
  try {
    formatCFamily(source, options);
  } catch (err) {
    expect(err).toBeInstanceOf(CFamilyFormatterError);
    return err as CFamilyFormatterError;
  }
  throw new Error('formatCFamily returned a result for options that must be refused');
}

/** The number of leading spaces of the first output line that starts with the text (once indentation is skipped). */
function indentOf(output: string, text: string): number {
  const line = output.split('\n').find((l) => l.trimStart().startsWith(text));
  if (line === undefined) throw new Error(`no line of the output starts with ${text}`);
  return line.length - line.trimStart().length;
}

it('the six languages are chosen by file name and a published clang-format unit test case of each reproduces exactly', () => {
  expect(C_FAMILY_LANGUAGES.map((l) => l.value)).toEqual(['c', 'cpp', 'csharp', 'java', 'objc', 'proto']);
  expect(new Set(F.PUBLISHED_CASES.map((c) => c.language))).toEqual(new Set(C_FAMILY_LANGUAGES.map((l) => l.value)));

  for (const published of F.PUBLISHED_CASES) {
    const options = { language: published.language, preset: published.preset };
    const fileName = C_FAMILY_LANGUAGES.find((l) => l.value === published.language)?.fileName;

    // The unit test's input formats to its expected text, and the expected text is already stable.
    expect(
      formatCFamily(published.input, options)?.output,
      `${published.test} (${published.file}:${published.line})`,
    ).toBe(published.expected);
    expect(engineControl.lastFileName).toBe(fileName);
    expect(engineControl.lastStyle).toBe(published.preset);
    expect(formatCFamily(published.expected, options)?.output, `${published.test} is stable`).toBe(published.expected);
  }

  // The names that select each language.
  expect(C_FAMILY_LANGUAGES.map((l) => l.fileName)).toEqual([
    'input.c',
    'input.cpp',
    'input.cs',
    'Input.java',
    'input.m',
    'input.proto',
  ]);
});

it('each named preset indents a block by its own width from Format.cpp at llvmorg-23.1.1', () => {
  // A statement inside a method inside a class is two levels deep, so it starts at twice the preset's IndentWidth.
  const source = 'class A { void f() { a(); b(); } };\n';
  for (const preset of C_FAMILY_PRESETS) {
    const width = F.PRESET_WIDTHS[preset].indentWidth;
    const output = formatCFamily(source, { language: 'cpp', preset })?.output ?? '';
    expect(indentOf(output, 'a'), `${preset}: a statement two levels deep`).toBe(2 * width);
    expect(indentOf(output, 'void'), `${preset}: a member one level deep`).toBe(width);
  }

  // An indent width replaces the preset's own: WebKit's four becomes two, and LLVM's two becomes six.
  const webkitTwo = formatCFamily(source, { language: 'cpp', preset: 'WebKit', indentWidth: 2 })?.output ?? '';
  expect(indentOf(webkitTwo, 'a')).toBe(4);
  const llvmSix = formatCFamily(source, { language: 'cpp', preset: 'LLVM', indentWidth: 6 })?.output ?? '';
  expect(indentOf(llvmSix, 'a')).toBe(12);

  // Chromium indents Java by four, not two (getChromiumStyle, Java only).
  const java =
    formatCFamily('class A { void f() { a(); b(); } }\n', { language: 'java', preset: 'Chromium' })?.output ?? '';
  expect(indentOf(java, 'a')).toBe(2 * F.CHROMIUM_JAVA_INDENT_WIDTH);
});

it('every language and preset pair formats without an engine error, or is refused by name as the limits state', () => {
  const samples: Record<CFamilyLanguage, string> = {
    c: 'int main(void){return 0;}\n',
    cpp: 'int main(){return 0;}\n',
    csharp: 'class A{void F(){var x=1;}}\n',
    java: 'class A{void f(){int x=1;}}\n',
    objc: '@interface A : NSObject\n- (void)f;\n@end\n',
    proto: 'message A{optional int32 a=1;}\n',
  };
  const refused: string[] = [];
  let formatted = 0;
  for (const { value: language } of C_FAMILY_LANGUAGES) {
    for (const preset of C_FAMILY_PRESETS) {
      try {
        const result = formatCFamily(samples[language], { language, preset });
        expect(result?.output.length ?? 0, `${preset} for ${language}`).toBeGreaterThan(0);
        formatted += 1;
      } catch (err) {
        expect(err).toBeInstanceOf(CFamilyFormatterError);
        const message = `${preset} style is not available for ${LANGUAGE_LABELS[language]} in clang-format.`;
        expect((err as CFamilyFormatterError).message).toBe(message);
        refused.push(message);
      }
    }
  }
  expect(formatted + refused.length).toBe(42);
  // Every refused pair must be listed in the limits; no pair is refused today, so none is listed.
  const listed = toolMeta.limits.filter((l) => l.includes('style is not available for'));
  expect(listed).toEqual(refused);
});

it('the style is built only from a named preset and a whole number, so text typed into the indent width never reaches the engine', () => {
  const callsBefore = engineControl.count;
  const hostile: [string, Partial<FormatCFamilyOptions>][] = [
    ['text after the number', { indentWidth: '4}, ColumnLimit: 1' as unknown as number }],
    ['a number written as text', { indentWidth: '4' as unknown as number }],
    [
      'a brace configuration as the preset',
      { preset: '{BasedOnStyle: LLVM, ColumnLimit: 1}' as unknown as CFamilyPreset },
    ],
    ['a second option after the preset', { preset: 'LLVM, IndentWidth: 99' as unknown as CFamilyPreset }],
    ['a file name as the language', { language: 'input.cpp' as unknown as CFamilyLanguage }],
    ['a path as the language', { language: '../input.c' as unknown as CFamilyLanguage }],
    ['not a number', { indentWidth: Number.NaN }],
    ['infinity', { indentWidth: Number.POSITIVE_INFINITY }],
  ];
  for (const [what, options] of hostile) {
    const err = failureOf('int x;\n', options);
    expect(err.message, what).not.toBe('');
    expect(err.line).toBeUndefined();
  }
  expect(engineControl.count).toBe(callsBefore);

  // Whatever is accepted reaches the engine as a preset name alone or as BasedOnStyle plus digits, nothing else.
  const names = C_FAMILY_PRESETS.join('|');
  const allowed = new RegExp(`^(${names})$|^\\{BasedOnStyle: (${names}), IndentWidth: [0-9]+\\}$`);
  for (const preset of C_FAMILY_PRESETS) {
    formatCFamily('int x;\n', { preset });
    expect(engineControl.lastStyle).toMatch(allowed);
    for (let width = 1; width <= 16; width++) {
      formatCFamily('int x;\n', { preset, indentWidth: width });
      expect(engineControl.lastStyle).toBe(`{BasedOnStyle: ${preset}, IndentWidth: ${width}}`);
      expect(engineControl.lastStyle).toMatch(allowed);
    }
  }
});

it('indent width outside 1 to 16 is refused naming the field and a blank indent width keeps the preset width', () => {
  const callsBefore = engineControl.count;
  for (const indentWidth of [0, 17, -98765, 3.5]) {
    const err = failureOf('int x;\n', { indentWidth });
    expect(err.message, String(indentWidth)).toBe('Indent width must be a whole number from 1 to 16.');
  }
  expect(engineControl.count).toBe(callsBefore);

  // The ends of the range are accepted.
  const source = 'class A { void f() { a(); b(); } };\n';
  expect(indentOf(formatCFamily(source, { indentWidth: 1 })?.output ?? '', 'void')).toBe(1);
  expect(indentOf(formatCFamily(source, { indentWidth: 16 })?.output ?? '', 'void')).toBe(16);

  // A blank width (left out) uses what the preset says: WebKit four, LLVM two. Naming the same width gives the same text.
  for (const preset of ['LLVM', 'WebKit'] as const) {
    const width = F.PRESET_WIDTHS[preset].indentWidth;
    const blank = formatCFamily(source, { preset })?.output;
    expect(indentOf(blank ?? '', 'void')).toBe(width);
    expect(formatCFamily(source, { preset, indentWidth: undefined })?.output).toBe(blank);
    expect(formatCFamily(source, { preset, indentWidth: width })?.output).toBe(blank);
  }
});

it('malformed code is formatted best effort and never refused, as the limits state', () => {
  const unbalanced = 'int main( {{{';
  const result = formatCFamily(unbalanced);
  expect(result).not.toBeNull();
  expect(result?.output).toContain('int main(');
  expect((result?.output.match(/\{/g) ?? []).length).toBe(3);

  // The same holds in every language and for text that is not code at all.
  for (const { value: language } of C_FAMILY_LANGUAGES) {
    for (const text of [unbalanced, 'a b c ( ] } ;', '} } {']) {
      expect(() => formatCFamily(text, { language }), `${language}: ${text}`).not.toThrow();
      expect(formatCFamily(text, { language })?.output.length).toBeGreaterThan(0);
    }
  }
  expect(toolMeta.limits.some((l) => l.includes('best effort') && l.includes('never refused'))).toBe(true);
});

// This test comes last on purpose, and loads its own copy of the package: a WebAssembly trap leaves the engine
// instance unusable (every later call traps too), which is why each page run uses a new worker.
it('2000 nested parentheses give the too large or too deeply nested message with no position', async () => {
  vi.resetModules();
  const fresh = await import('../src/index');
  fresh.loadEngine(wasmBytes());
  const source = `int x = ${'('.repeat(2000)}1${')'.repeat(2000)};\n`;
  let caught: unknown;
  try {
    fresh.formatCFamily(source);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(fresh.CFamilyFormatterError);
  const error = caught as CFamilyFormatterError;
  expect(error.message).toBe('This input is too large or too deeply nested for the formatter.');
  expect(error.line).toBeUndefined();
  expect(error.column).toBeUndefined();
});

// One trap leaves the clang-format instance broken for good (every later call traps too, even on a valid program),
// and the package offers no way to start a new instance. So the folder remembers the trap and says so, instead of
// blaming each later input for being too large.
it('after a too large input every later call says the engine stopped and must be loaded again', async () => {
  vi.resetModules();
  const fresh = await import('../src/index');
  fresh.loadEngine(wasmBytes());
  expect(() => fresh.formatCFamily(`int x = ${'('.repeat(2000)}1${')'.repeat(2000)};\n`)).toThrow(
    'This input is too large or too deeply nested for the formatter.',
  );

  for (const options of [{}, { language: 'java' as const }, { preset: 'Google' as const }]) {
    let caught: unknown;
    try {
      fresh.formatCFamily('int main(){return 0;}\n', options);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(fresh.CFamilyFormatterError);
    const error = caught as CFamilyFormatterError;
    expect(error.message).toMatch(/stopped after an earlier input that was too large or too deeply nested/);
    expect(error.message).toMatch(/new worker or process/);
    expect(error.message).not.toMatch(/^This input is too large/);
    expect(error.line).toBeUndefined();
  }
  expect(fresh.formatCFamily('  \n')).toBeNull();
  expect(() => fresh.formatCFamily('int x;\n', { indentWidth: 99 })).toThrow(
    'Indent width must be a whole number from 1 to 16.',
  );
});

it('the limits say the engine must be loaded again after a too large input', () => {
  expect(toolMeta.limits.some((l) => l.includes('new worker or process'))).toBe(true);
});
