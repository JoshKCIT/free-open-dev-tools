import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import {
  IMPORT_REFUSED_MESSAGE,
  LESS_VERSION,
  MAX_OUTPUT_BYTES,
  MAX_SOURCE_BYTES,
  MAX_WARNING_CHARS,
  MAX_WARNINGS,
  StylesheetError,
  checkSource,
  compileStylesheet,
  findCssImport,
  isBlankSource,
  meta as toolMeta,
  type Language,
} from '../src/index';

const BS = String.fromCharCode(92);

let consoleSpies: MockInstance[] = [];

beforeEach(() => {
  consoleSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
    vi.spyOn(console, 'debug').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

/** Compiles and returns the thrown error, failing the test when the compile succeeds. */
async function failureOf(source: string, language: Language, style: 'expanded' | 'compressed' = 'expanded') {
  try {
    await compileStylesheet(source, { language, style });
  } catch (err) {
    expect(err).toBeInstanceOf(StylesheetError);
    return err as StylesheetError;
  }
  throw new Error('the compile was expected to fail');
}

/** The refusal sentence the page shows for an import at a position of the source. */
function refusal(line: number, column: number, target?: string): string {
  return `${IMPORT_REFUSED_MESSAGE} (line ${line}, column ${column}).${target === undefined ? '' : ` Target: ${target}`}`;
}

/** The refusal sentence for a plain CSS import found in the compiled CSS. */
function outputRefusal(line: number, column: number, target: string): string {
  return `${IMPORT_REFUSED_MESSAGE} (line ${line}, column ${column} of the compiled CSS). Target: ${target}`;
}

// The Less language reference (https://lesscss.org/features/#operations): since version 4 a division is calculated
// only inside parentheses by default, so a bare 10px / 2 stays as written and (10px / 2) gives 5px.
it('in Less default math mode 10px / 2 stays as written and (10px / 2) gives 5px', async () => {
  const result = await compileStylesheet('.a { b: 10px / 2; c: (10px / 2); }', { language: 'less', style: 'expanded' });
  expect(result.css.trim()).toBe('.a {\n  b: 10px / 2;\n  c: 5px;\n}');
  const compressed = await compileStylesheet('.a { b: 10px / 2; c: (10px / 2); }', {
    language: 'less',
    style: 'compressed',
  });
  expect(compressed.css.trim()).toBe('.a{b:10px / 2;c:5px}');
});

it('Sass use, forward, import and load-css of another file or address are refused with line and column', async () => {
  // [source, syntax, line, column, shown target]. The position is the one the compiler reports for the statement:
  // a use, forward or load-css call starts at its first character, an import at the quoted address.
  const cases: [string, Language, number, number, string][] = [
    ['@use "foo";', 'scss', 1, 1, 'foo'],
    ['\n\n  @forward "foo";', 'scss', 3, 3, 'foo'],
    ['@import "foo";', 'scss', 1, 9, 'foo'],
    ['@use "sass:meta";\n@include meta.load-css("foo");', 'scss', 2, 1, 'foo'],
    ['@use "http://127.0.0.1:1/x";', 'scss', 1, 1, 'http://127.0.0.1:1/x'],
    ['@use "foo"\n', 'sass', 1, 1, 'foo'],
  ];
  for (const [source, language, line, column, target] of cases) {
    const error = await failureOf(source, language);
    expect(error.kind, source).toBe('import');
    expect(error.line, source).toBe(line);
    expect(error.column, source).toBe(column);
    expect(error.message, source).toBe(refusal(line, column, target));
  }

  // A built-in module is not another file.
  const math = await compileStylesheet('@use "sass:math";\n.a { b: math.div(10, 2); }', {
    language: 'scss',
    style: 'expanded',
  });
  expect(math.css).toBe('.a {\n  b: 5;\n}');

  // A long target is cut to 40 characters, and a direction mark in it never reaches the message raw (Sass hands the
  // address over percent-encoded, Less hands the file name over as written and the message shows it escaped).
  const long = await failureOf(`@use "${'a'.repeat(100)}";`, 'scss');
  expect(long.message).toContain('a'.repeat(40));
  expect(long.message).not.toContain('a'.repeat(41));
  const rlo = String.fromCodePoint(0x202e);
  const marked = await failureOf(`@use "foo${rlo}bar";`, 'scss');
  expect(marked.message).not.toContain(rlo);
  const markedLess = await failureOf(`@import "foo${rlo}bar";`, 'less');
  expect(markedLess.message).toContain(`foo${BS}u{202E}bar`);
  expect(markedLess.message).not.toContain(rlo);
});

it('Less imports, plugins, data-uri with a file, optional imports and an address are refused with line and column', async () => {
  // [source, line, column, shown target]. Each refusal is also what the one refusing file manager, plugin loader or
  // function was asked, so nothing was read.
  const cases: [string, number, number, string][] = [
    ['@import "foo";', 1, 1, 'foo'],
    ['\n  @import (less) "http://127.0.0.1:1/x.less";', 2, 3, 'http://127.0.0.1:1/x.less'],
    ['.a{}\n@import (optional) "missing";', 2, 1, 'missing'],
    ['@plugin "x";', 1, 1, 'x'],
    ['.a{b: data-uri("x.png")}', 1, 7, 'x.png'],
    ['.a {\n  b: image-size("x.png");\n}', 2, 6, 'x.png'],
  ];
  for (const [source, line, column, target] of cases) {
    const error = await failureOf(source, 'less');
    expect(error.kind, source).toBe('import');
    expect(error.line, source).toBe(line);
    expect(error.column, source).toBe(column);
    expect(error.message, source).toBe(refusal(line, column, target));
  }

  // Inline JavaScript is off, so a backtick expression is a plain error and nothing runs.
  const script = await failureOf('.a { b: `1 + 1`; }', 'less');
  expect(script.kind).toBe('syntax');
  expect(script.line).toBe(1);
});

it('a plain CSS import passed through by either compiler is refused with its line and column', async () => {
  // Both compilers copy these into the CSS without asking any importer or file manager. Both also move a plain
  // import to the top of the output, so the position is in the compiled CSS, and the message says so.
  const scss: [string, string][] = [
    ['@import url(foo.css);', 'url(foo.css)'],
    ['@import "foo.css";', '"foo.css"'],
    ['@import "http://example.invalid/x.css";', '"http://example.invalid/x.css"'],
    ['@import "foo" screen;', '"foo" screen'],
    ['a { b: c }\n@import url(x.css);', 'url(x.css)'],
    [`@${BS}69mport "x.css";`, '"x.css"'],
    ['@#{"import"} "x.css";', '"x.css"'],
  ];
  for (const [source, target] of scss) {
    const error = await failureOf(source, 'scss');
    expect(error.kind, source).toBe('import');
    expect(error.line, source).toBe(1);
    expect(error.column, source).toBe(1);
    expect(error.message, source).toBe(outputRefusal(1, 1, target));
  }
  const less: [string, string][] = [
    ['@import url(foo.css);', 'url(foo.css)'],
    ['@import (css) "foo.css";', '"foo.css"'],
    ['@import "http://example.invalid/x.css";', '"http://example.invalid/x.css"'],
    ['a { b: c }\n@import url(x.css);', 'url(x.css)'],
  ];
  for (const [source, target] of less) {
    const error = await failureOf(source, 'less');
    expect(error.kind, source).toBe('import');
    expect(error.message, source).toBe(outputRefusal(1, 1, target));
  }

  // The word inside a comment or a string is not an import.
  const scssFine = await compileStylesheet(
    '/* @import "a.css"; */\n// @import "c.css";\n.a { content: "@import b.css"; }',
    {
      language: 'scss',
      style: 'expanded',
    },
  );
  expect(scssFine.css).toContain('content: "@import b.css"');
  const lessFine = await compileStylesheet(
    '/* @import "a.css"; */\n// @import "c.css";\n.a { content: "@import b.css"; }',
    {
      language: 'less',
      style: 'expanded',
    },
  );
  expect(lessFine.css).toContain('content: "@import b.css"');
});

it('the import scan skips comments and strings and runs in linear time on 512 KiB of hostile text', () => {
  expect(findCssImport('@import "a.css";')).toEqual({ line: 1, column: 1 });
  expect(findCssImport('a { b: c }\n  @IMPORT url(x);')).toEqual({ line: 2, column: 3 });
  expect(findCssImport('a { b: c }\r\n@Import "x";')).toEqual({ line: 2, column: 1 });
  expect(findCssImport('@media print { @import "x.css"; }')).toEqual({ line: 1, column: 16 });
  // A name that only starts like the keyword, and a different at-rule, are not an import.
  expect(findCssImport('@important { a: b }')).toBeNull();
  expect(findCssImport('@import-x { a: b } @imports { }')).toBeNull();
  expect(findCssImport('@media print { a { b: c } }')).toBeNull();
  // An escaped keyword is still the keyword to a browser.
  expect(findCssImport(`@${BS}69mport "x.css";`)).toEqual({ line: 1, column: 1 });
  expect(findCssImport(`@${BS}49 mport "x.css";`)).toEqual({ line: 1, column: 1 });
  // Comments and strings hide the word; an unterminated one hides the rest.
  expect(findCssImport('/* @import "x"; */ a { b: c }')).toBeNull();
  expect(findCssImport('a { content: "@import x"; }')).toBeNull();
  expect(findCssImport(`a { content: '${BS}' @import x'; }`)).toBeNull();
  expect(findCssImport('/* @import "x";')).toBeNull();
  expect(findCssImport('"@import x')).toBeNull();
  // A string ends at a line break (a bad string), so an import on the next line is found.
  expect(findCssImport('a { content: "oops\n}\n@import "x.css";')).toEqual({ line: 3, column: 1 });
  // The column counts a reader's characters, so an astral character before the import is one column.
  expect(findCssImport('/* \u{1F600} */ @import "x.css";')).toEqual({ line: 1, column: 9 });

  // Hostile text, 512 KiB each. Only the scan is timed; every expect comes after the second clock reading.
  const size = 512 * 1024;
  let seed = 7;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pieces = [
    `"${BS}${BS}\n`,
    `'${BS}`,
    '@impor',
    '@',
    `@${'a'.repeat(300)}`,
    '"x',
    ` ${BS}`,
    '*',
    'url(',
    '\n',
    '@@import',
  ];
  let mixed = '';
  while (mixed.length < size) mixed += pieces[Math.floor(random() * pieces.length)]!;
  const lines = 'a { b: c }\n'.repeat(Math.floor(size / 11)) + '@import "x";';
  const texts: [string, string][] = [
    ['mixed pieces', mixed],
    ['comment openers', '/*'.repeat(size / 2)],
    ['one string', '"'.repeat(size)],
    ['lone at signs', '@'.repeat(size)],
    ['long name', `@${'a'.repeat(size)}`],
    ['backslashes', BS.repeat(size)],
    ['bad strings', '"x\n'.repeat(size / 3)],
    ['many lines', lines],
  ];
  const results: [string, number, { line: number; column: number } | null][] = [];
  for (const [name, text] of texts) {
    const start = performance.now();
    const found = findCssImport(text);
    const elapsed = performance.now() - start;
    results.push([name, elapsed, found]);
  }
  for (const [name, elapsed] of results) expect(elapsed, name).toBeLessThan(5_000);
  expect(results.find(([name]) => name === 'many lines')![2]).toEqual({ line: Math.floor(size / 11) + 1, column: 1 });
  expect(results.find(([name]) => name === 'comment openers')![2]).toBeNull();
}, 60_000);

it('a source over 256 KiB in UTF-8 bytes and compiled output over 2 MiB are refused with a plain message', async () => {
  expect(MAX_SOURCE_BYTES).toBe(262_144);
  expect(MAX_OUTPUT_BYTES).toBe(2_097_152);
  expect(() => checkSource('a'.repeat(262_144))).not.toThrow();
  let thrown: unknown;
  try {
    checkSource('a'.repeat(262_145));
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(StylesheetError);
  expect((thrown as StylesheetError).kind).toBe('limit');
  expect((thrown as StylesheetError).message).toBe(
    'This paste is 262145 bytes. The limit is 256 KiB because larger stylesheets make the compiler run too long in the browser.',
  );
  // Counted in bytes, not characters: 131073 two-byte characters are only 131073 characters long.
  const twoByte = 'é'.repeat(131_073);
  expect(twoByte.length).toBe(131_073);
  expect(() => checkSource(twoByte)).toThrow(/262146 bytes/);
  // compileStylesheet checks the source before it starts any engine.
  const tooBig = await failureOf('a'.repeat(262_145), 'scss');
  expect(tooBig.kind).toBe('limit');

  // A loop that writes about 3 MiB of CSS is refused after compiling, with the size and the limit in the message.
  const loop = await failureOf('@for $i from 1 through 100000 { .a#{$i} { width: #{$i}px; } }', 'scss');
  expect(loop.kind).toBe('limit');
  expect(loop.line).toBeUndefined();
  expect(loop.message).toMatch(/^The compiled CSS is \d+ bytes\. The limit is 2 MiB because /);
}, 60_000);

it('an empty or blank source is blank and compiles nothing', async () => {
  expect(isBlankSource('')).toBe(true);
  expect(isBlankSource('   \n\t  \r\n')).toBe(true);
  expect(isBlankSource('/* a comment */')).toBe(false);
  expect(isBlankSource('a')).toBe(false);
  for (const language of ['scss', 'sass', 'less'] as const) {
    for (const source of ['', ' \n\t ']) {
      expect(await compileStylesheet(source, { language, style: 'expanded' })).toEqual({
        css: '',
        warnings: [],
        engine: '',
      });
    }
  }
});

it('a syntax error after an astral character reports the column a reader counts from 1', async () => {
  // The grinning face is one character to a reader and two UTF-16 code units to JavaScript. In the first line below
  // the broken name starts at the 23rd character; in UTF-16 it would be the 25th.
  const scss = await failureOf('a { content: "\u{1F600}\u{1F600}"; b: $nope; }', 'scss');
  expect(scss.kind).toBe('syntax');
  expect(scss.line).toBe(1);
  expect(scss.column).toBe(23);
  const less = await failureOf('.a { content: "\u{1F600}\u{1F600}"; b: @nope; }', 'less');
  expect(less.kind).toBe('syntax');
  expect(less.line).toBe(1);
  expect(less.column).toBe(24);
  // Lines are counted as a reader counts them, whatever the line ends are.
  for (const lineEnd of ['\n', '\r\n']) {
    const second = await failureOf(`a {${lineEnd}  b: $nope;${lineEnd}}`, 'scss');
    expect([second.line, second.column]).toEqual([2, 6]);
    const secondLess = await failureOf(`.a {${lineEnd}  b: @nope;${lineEnd}}`, 'less');
    expect([secondLess.line, secondLess.column]).toEqual([2, 6]);
  }
  // The indented syntax counts the same way.
  const indented = await failureOf('a\n  b: $nope\n', 'sass');
  expect([indented.line, indented.column]).toEqual([2, 6]);
  // The message names the position and says nothing about UTF-16.
  expect(scss.message).toMatch(/\(line 1, column 23\)/);
});

it('a marker inside a broken stylesheet never appears in a message, warning or label', async () => {
  const marker = 'FODT-SECRET-7Q2';
  const broken: [string, Language][] = [
    [`a { b: $${marker}; }`, 'scss'],
    [`a { b: ${marker} * 2; }`, 'scss'],
    [`@error "${marker}";`, 'scss'],
    [`@include ${marker};`, 'scss'],
    [`a { ${marker} }`, 'scss'],
    [`a\n  b: ${marker} * 2\n`, 'sass'],
    [`.a { b: @${marker}; }`, 'less'],
    [`.${marker}();`, 'less'],
    [`.a { .${marker}; }`, 'less'],
    [`.a { ${marker} }`, 'less'],
    [`.a { b: ${marker} * 2px; }`, 'less'],
    [`.a { b: percentage(${marker}); }`, 'less'],
    [`.a { color: darken(${marker}, 10%); }`, 'less'],
  ];
  for (const [source, language] of broken) {
    const error = await failureOf(source, language);
    expect(error.kind, source).toBe('syntax');
    expect(error.message, source).not.toContain(marker);
    expect(error.message, source).not.toContain('SECRET');
    expect(error.message.length, source).toBeLessThanOrEqual(240);
    expect(error.message, source).toMatch(/\(line \d+, column \d+\)/);
  }
  // A source that compiles carries its text into the CSS only; no warning or other field holds it.
  const fine = await compileStylesheet(`.a { content: "${marker}"; }`, { language: 'scss', style: 'expanded' });
  expect(JSON.stringify({ warnings: fine.warnings, engine: fine.engine })).not.toContain(marker);
});

it('Sass warn and debug messages are captured and capped at 20 messages of 200 characters', async () => {
  expect(MAX_WARNINGS).toBe(20);
  expect(MAX_WARNING_CHARS).toBe(200);
  const basic = await compileStylesheet('@debug "hello";\n@warn "careful";\na { b: c }', {
    language: 'scss',
    style: 'expanded',
  });
  expect(basic.css).toBe('a {\n  b: c;\n}');
  expect(basic.warnings).toEqual(['@debug: hello', '@warn: careful']);

  // Thirty messages: the first 19 are kept and the 20th says how many were left out.
  const many = await compileStylesheet('@for $i from 1 through 30 { @warn "w#{$i}"; }\na { b: c }', {
    language: 'scss',
    style: 'expanded',
  });
  expect(many.warnings).toHaveLength(20);
  expect(many.warnings.slice(0, 19)).toEqual(Array.from({ length: 19 }, (_, i) => `@warn: w${i + 1}`));
  expect(many.warnings[19]).toBe('11 more messages were left out.');

  // A 500 character message is cut to 200 characters and ends with an ellipsis.
  const long = await compileStylesheet(
    '@function rep($s, $n) { $r: ""; @for $i from 1 through $n { $r: $r + $s; } @return $r; }\n@warn rep("x", 500);\na { b: c }',
    { language: 'scss', style: 'expanded' },
  );
  expect(long.warnings).toHaveLength(1);
  expect(long.warnings[0]).toHaveLength(200);
  expect(long.warnings[0]!.startsWith('@warn: xxx')).toBe(true);
  expect(long.warnings[0]!.endsWith('...')).toBe(true);

  // A direction mark in a message is shown escaped.
  const rlo = String.fromCodePoint(0x202e);
  const bidi = await compileStylesheet(`@warn "a${rlo}b";\na { b: c }`, { language: 'scss', style: 'expanded' });
  expect(bidi.warnings).toEqual([`@warn: a${BS}u{202E}b`]);

  // The compiler's own deprecation notice is one short line.
  const deprecated = await compileStylesheet('$x: 10px;\na { b: $x / 2 }', { language: 'scss', style: 'expanded' });
  expect(deprecated.warnings).toHaveLength(1);
  expect(deprecated.warnings[0]).not.toContain('\n');
  expect(deprecated.warnings[0]!.length).toBeLessThanOrEqual(200);

  // Less has no such messages.
  const less = await compileStylesheet('.a { b: c }', { language: 'less', style: 'expanded' });
  expect(less.warnings).toEqual([]);
}, 60_000);

it('meta pins sass 1.103.1 and less 4.9.1 exactly', async () => {
  expect(toolMeta.dependencies).toEqual({ sass: '1.103.1', less: '4.9.1' });
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  expect(pkg.dependencies).toEqual({ sass: '1.103.1', less: '4.9.1' });
  // The installed packages are the pinned versions, and the engines report them.
  for (const name of ['sass', 'less']) {
    const installed = JSON.parse(
      readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'),
    ) as {
      version: string;
    };
    expect(installed.version).toBe(toolMeta.dependencies[name as 'sass' | 'less']);
  }
  expect(LESS_VERSION).toBe('4.9.1');
  expect((await compileStylesheet('a { b: c }', { language: 'scss', style: 'expanded' })).engine).toBe('Sass 1.103.1');
  expect((await compileStylesheet('a\n  b: c\n', { language: 'sass', style: 'expanded' })).engine).toBe('Sass 1.103.1');
  expect((await compileStylesheet('a { b: c }', { language: 'less', style: 'expanded' })).engine).toBe('Less 4.9.1');
});

it('nothing is written to the console while compiling', async () => {
  await compileStylesheet('@debug "d";\n@warn "w";\na { b: c }', { language: 'scss', style: 'compressed' });
  await compileStylesheet('.a { b: c }', { language: 'less', style: 'compressed' });
  await failureOf('a { b: $nope; }', 'scss');
  await failureOf('@import "foo";', 'less');
  await failureOf('@use "foo";', 'scss');
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});
