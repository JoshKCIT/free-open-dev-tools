import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import phpPlugin from '@prettier/plugin-php/standalone';
import {
  formatPhp,
  hasPhpOpeningTag,
  PhpFormatterError,
  PHP_VERSIONS,
  meta as toolMeta,
  type FormatPhpOptions,
} from '../src/index';
import { PUBLISHED_CASES, type PublishedCase } from './fixtures/prettier-plugin-php/golden';

// Prettier's own entry is wrapped only to COUNT calls and to RECORD the options it is called with, so a test can
// prove blank input and refused options never reach it and that a concrete PHP version always does. Otherwise the
// wrapper calls straight through; it is a spy, never an oracle.
const engineControl = vi.hoisted(() => ({ count: 0, lastOptions: undefined as undefined | Record<string, unknown> }));
vi.mock('prettier/standalone', async (importOriginal) => {
  const real = await importOriginal<typeof import('prettier/standalone')>();
  const wrapped = {
    ...real,
    format: (...args: Parameters<typeof real.format>) => {
      engineControl.count += 1;
      engineControl.lastOptions = args[1] as Record<string, unknown> | undefined;
      return real.format(...args);
    },
  };
  return { ...wrapped, default: wrapped };
});

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  engineControl.count = 0;
  engineControl.lastOptions = undefined;
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  for (const spy of consoleSpies) spy.mockRestore();
});

/** Runs formatPhp and returns the PhpFormatterError it must throw. */
async function failureOf(source: string, options: Partial<FormatPhpOptions> = {}): Promise<PhpFormatterError> {
  try {
    await formatPhp(source, options);
  } catch (err) {
    expect(err).toBeInstanceOf(PhpFormatterError);
    return err as PhpFormatterError;
  }
  throw new Error('formatPhp returned a result for source that must be refused');
}

const caseLabel = (c: PublishedCase): string => `${c.file}:${c.line} ${c.name}`;

/**
 * The options a published case ran with, as the page offers them. A case that passed no PHP version ran with the
 * plugin default (automatic detection, which falls back to 8.5), and the page cannot use automatic detection, so
 * 8.5 is passed explicitly. Prettier's own trailingComma default is already "all", which is what the two cases that
 * name it ask for, so it is not passed.
 */
function pageOptionsOf(c: PublishedCase): Partial<FormatPhpOptions> {
  const o = c.options;
  const options: Partial<FormatPhpOptions> = { phpVersion: typeof o.phpVersion === 'string' ? o.phpVersion : '8.5' };
  if (typeof o.printWidth === 'number') options.printWidth = o.printWidth;
  if (typeof o.singleQuote === 'boolean') options.singleQuote = o.singleQuote;
  if (typeof o.trailingCommaPHP === 'boolean') options.trailingCommaPHP = o.trailingCommaPHP;
  if (o.braceStyle === 'per-cs' || o.braceStyle === '1tbs') options.braceStyle = o.braceStyle;
  return options;
}

const OFFERED_OPTION_NAMES = [
  'printWidth',
  'phpVersion',
  'singleQuote',
  'trailingCommaPHP',
  'braceStyle',
  'trailingComma',
];

/** True when every option the case ran with is one the page offers (or, for trailingComma, Prettier's own default). */
function usesOnlyOfferedOptions(c: PublishedCase): boolean {
  const o = c.options;
  if (!Object.keys(o).every((k) => OFFERED_OPTION_NAMES.includes(k))) return false;
  if ('trailingComma' in o && o.trailingComma !== 'all') return false;
  if ('braceStyle' in o && o.braceStyle !== 'per-cs' && o.braceStyle !== '1tbs') return false;
  return true;
}

// Fixtures: the Prettier PHP plugin's own published tests at tag v0.25.0 (snapshot files under tests/<directory>/
// __snapshots__/jsfmt.spec.mjs.snap, and the inline test in tests/single-quote-api/jsfmt.spec.mjs).
// URL: https://github.com/prettier/plugin-php/tree/v0.25.0/tests (MIT, see ./fixtures/prettier-plugin-php/LICENSE)

it('prettier plugin-php 0.25.0 array snapshot: the first published case reproduces with its options', async () => {
  const first = PUBLISHED_CASES[0];
  expect(first?.file).toBe('tests/array/__snapshots__/jsfmt.spec.mjs.snap');
  expect(first?.name).toBe('arrays.php 1');
  if (!first) return;
  const result = await formatPhp(first.input, pageOptionsOf(first));
  expect(result?.output).toBe(first.output);
});

it('blank or whitespace-only source is not sent to the engine and gives no result', async () => {
  expect(await formatPhp('')).toBeNull();
  expect(await formatPhp('   \n\t  \n')).toBeNull();
  expect(engineControl.count).toBe(0);
});

it('formatting twice in a row works and nothing is printed to the console', async () => {
  const first = PUBLISHED_CASES[0];
  if (!first) throw new Error('the published fixture has no cases');
  const options = pageOptionsOf(first);
  const a = await formatPhp(first.input, options);
  const b = await formatPhp(first.input, options);
  expect(a?.output).toBe(first.output);
  expect(b?.output).toBe(first.output);
  expect(engineControl.count).toBe(2);
  // The byte counts are UTF-8 lengths of the text in and out.
  expect(a?.inputBytes).toBe(new TextEncoder().encode(first.input).length);
  expect(a?.outputBytes).toBe(new TextEncoder().encode(first.output).length);
});

it('meta pins the PHP plugin and Prettier exactly', () => {
  expect(toolMeta.id).toBe('php-formatter');
  expect(toolMeta.dependencies).toEqual({ '@prettier/plugin-php': '0.25.0', prettier: '3.9.9' });
  expect(toolMeta.limits.length).toBeGreaterThan(0);
});

// Every published case whose options the page does not offer, by name, with the option and why it is left out.
// Nothing else is left out: the test below fails if this list and the computed one differ.
const LEFT_OUT: { file: string; name: string; option: string }[] = [
  {
    file: 'tests/brace-style/__snapshots__/jsfmt.spec.mjs.snap',
    name: 'classes.php 2',
    option: 'braceStyle psr-2 (deprecated in the plugin, not offered)',
  },
  {
    file: 'tests/brace-style/__snapshots__/jsfmt.spec.mjs.snap',
    name: 'functions.php 2',
    option: 'braceStyle psr-2 (deprecated in the plugin, not offered)',
  },
  {
    file: 'tests/brace-style/__snapshots__/jsfmt.spec.mjs.snap',
    name: 'methods.php 2',
    option: 'braceStyle psr-2 (deprecated in the plugin, not offered)',
  },
  {
    file: 'tests/trailing_comma_func/__snapshots__/jsfmt.spec.mjs.snap',
    name: 'function.php 2',
    option: 'trailingComma none (Prettier option, not offered; the page leaves it at all)',
  },
];

it('prettier plugin-php 0.25.0 snapshots: the published cases reproduce with their options and an explicit PHP version', async () => {
  // The 18 cases of the seven snapshot directories array, arrowfunc, assign, class, if, string and switch, plus the
  // cases of the directories that exercise the options the page offers: brace-style, string-single-quote,
  // string-double-quote, trailing_commas, trailing_comma_func, attributes-trail-comma and the single quote API test.
  expect(PUBLISHED_CASES).toHaveLength(66);

  const leftOut = PUBLISHED_CASES.filter((c) => !usesOnlyOfferedOptions(c));
  expect(leftOut.map((c) => `${c.file} ${c.name}`)).toEqual(LEFT_OUT.map((c) => `${c.file} ${c.name}`));

  const reproduced = PUBLISHED_CASES.filter(usesOnlyOfferedOptions);
  expect(reproduced).toHaveLength(62);
  for (const c of reproduced) {
    const result = await formatPhp(c.input, pageOptionsOf(c));
    expect(result?.output, caseLabel(c)).toBe(c.output);
    // Every call hands Prettier a concrete PHP version, never automatic detection.
    expect(PHP_VERSIONS, caseLabel(c)).toContain(engineControl.lastOptions?.phpVersion);
  }
});

it('the PHP version auto and composer are refused and a concrete version from the plugin list is always passed', async () => {
  // The offered versions are the plugin's own list without the two values that read the file system.
  const choices = (phpPlugin.options?.phpVersion as unknown as { choices: { value: string }[] }).choices.map(
    (c) => c.value,
  );
  expect(choices).toContain('auto');
  expect(choices).toContain('composer');
  expect(PHP_VERSIONS).toEqual(choices.filter((v) => v !== 'auto' && v !== 'composer'));
  expect(PHP_VERSIONS).toHaveLength(18);
  expect(PHP_VERSIONS[0]).toBe('5.0');
  expect(PHP_VERSIONS[PHP_VERSIONS.length - 1]).toBe('8.5');

  for (const refused of ['auto', 'composer', '9.9', '', ' 8.5', '8.5 ', '8.50', '8', 'AUTO', '4.9']) {
    const err = await failureOf('<?php\n$a = 1;\n', { phpVersion: refused });
    expect(err.message, JSON.stringify(refused)).toContain('PHP version');
    expect(err.line).toBeUndefined();
    expect(err.column).toBeUndefined();
  }
  // A refused version never reaches Prettier.
  expect(engineControl.count).toBe(0);

  // Every version in the list is accepted and is the one Prettier is handed.
  for (const version of PHP_VERSIONS) {
    const result = await formatPhp('<?php\n$a = 1;\n', { phpVersion: version });
    expect(result, version).not.toBeNull();
    expect(engineControl.lastOptions?.phpVersion).toBe(version);
  }
  expect(engineControl.count).toBe(PHP_VERSIONS.length);

  // With no version chosen, 8.5, the newest the plugin lists, is passed.
  await formatPhp('<?php\n$a = 1;\n');
  expect(engineControl.lastOptions?.phpVersion).toBe('8.5');
});

it('a PHP syntax error names its line and a 1-based column and gives no formatted code', async () => {
  // Counted by hand. Line 2 is `$a = ;`: the dollar sign is column 1, a 2, a space 3, the equals sign 4, a space 5
  // and the semicolon, where an expression must be, is column 6. The plugin reports 5, counting from zero.
  const missing = await failureOf('<?php\n$a = ;\n');
  expect(missing.message).toBe("Parse Error : syntax error, unexpected ';' on line 2");
  expect(missing.line).toBe(2);
  expect(missing.column).toBe(6);

  // A function whose closing brace never comes: the parser looks for it at the end of the input, after the final
  // line break, which is line 3 column 1 (the plugin reports column 0).
  const unclosed = await failureOf('<?php\nfunction f() {\n');
  expect(unclosed.message).toBe("Parse Error : syntax error, expecting '}' on line 3");
  expect(unclosed.line).toBe(3);
  expect(unclosed.column).toBe(1);

  // The same error after Windows line breaks and after lone carriage returns is still on line 2, column 6.
  for (const source of ['<?php\r\n$a = ;\r\n', '<?php\r$a = ;\r']) {
    const err = await failureOf(source);
    expect([err.line, err.column], JSON.stringify(source)).toEqual([2, 6]);
  }

  // A tab is one character: the semicolon of `<tab>$a = ;` is column 7.
  const tabbed = await failureOf('<?php\n\t$a = ;\n');
  expect([tabbed.line, tabbed.column]).toEqual([2, 7]);

  // The message is the first line only: no code frame follows it.
  expect(missing.message).not.toContain('\n');
  expect(missing.message).not.toContain('|');
});

it('the column counts characters, so a non-ASCII character before the error counts once', async () => {
  // Counted by hand. In `$a = "<c>"; $b = ;` the text `$a = "` is 6 characters, <c> is the 7th, then `"; $b = ` is
  // 8 more, so 15 characters come before the semicolon, which is column 16, whichever single character <c> is.
  // The plugin counts UTF-16 code units from zero and says 15 for a plain letter or an accented letter and 16 for an
  // emoji (two code units), so only the emoji needs the conversion.
  for (const c of ['x', 'é', '日', '😀']) {
    const err = await failureOf(`<?php\n$a = "${c}"; $b = ;\n`);
    expect([err.line, err.column], c).toEqual([2, 16]);
  }
  // An accented letter written as a plain e and a combining accent is two characters (two code points), so the
  // semicolon is column 17.
  const combining = await failureOf('<?php\n$a = "é"; $b = ;\n');
  expect([combining.line, combining.column]).toEqual([2, 17]);
  // A character before the error on an earlier line does not shift the column of a later line.
  const earlier = await failureOf('<?php\n$é = "😀";\n$b = ;\n');
  expect([earlier.line, earlier.column]).toEqual([3, 6]);
});

it('options outside their ranges are refused naming the field before the engine runs', async () => {
  const source = '<?php\n$a = 1;\n';
  for (const printWidth of [19, 201, -98765, 80.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const err = await failureOf(source, { printWidth });
    expect(err.message, String(printWidth)).toBe('Print width must be a whole number from 20 to 200.');
  }
  for (const tabWidth of [0, 17, -98765, 2.5, Number.NaN]) {
    const err = await failureOf(source, { tabWidth });
    expect(err.message, String(tabWidth)).toBe('Indent width must be a whole number from 1 to 16.');
  }
  const brace = await failureOf(source, { braceStyle: 'psr-2' as 'per-cs' });
  expect(brace.message).toBe('Brace style must be per-cs or 1tbs.');
  expect(engineControl.count).toBe(0);

  // The limits themselves are accepted.
  for (const options of [{ printWidth: 20 }, { printWidth: 200 }, { tabWidth: 1 }, { tabWidth: 16 }]) {
    expect(await formatPhp(source, options), JSON.stringify(options)).not.toBeNull();
  }
  expect(engineControl.count).toBe(4);
});

it('the indent width, tabs and print width change the layout as the Prettier options document', async () => {
  // Prettier documents tabWidth as the number of spaces per indentation level, useTabs as one tab per level and
  // printWidth as the line length the printer tries to stay within. The statement below sits two levels deep.
  const source = '<?php\nfunction f($a) {\nif ($a) {\nreturn 1;\n}\n}\n';
  const indentOf = (output: string): string => /^(\s*)return 1;/m.exec(output)?.[1] ?? 'no return line';
  expect(indentOf((await formatPhp(source, { tabWidth: 2 }))?.output ?? '')).toBe('    ');
  expect(indentOf((await formatPhp(source, { tabWidth: 4 }))?.output ?? '')).toBe('        ');
  expect(indentOf((await formatPhp(source, { useTabs: true }))?.output ?? '')).toBe('\t\t');

  const list = "<?php\n$a = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc', 'dddddddddd'];\n";
  const wide = (await formatPhp(list, { printWidth: 80 }))?.output ?? '';
  expect(wide).toContain('"aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc", "dddddddddd"');
  const narrow = (await formatPhp(list, { printWidth: 40 }))?.output ?? '';
  expect(narrow.split('\n').length).toBeGreaterThan(3);
  for (const line of narrow.split('\n')) expect(line.length).toBeLessThanOrEqual(40);
});

it('300 nested arrays give the too large or too deeply nested message with no position', async () => {
  const source = `<?php\n$a = ${'['.repeat(300)}${']'.repeat(300)};\n`;
  const err = await failureOf(source);
  expect(err.message).toBe('This input is too large or too deeply nested for the formatter.');
  expect(err.line).toBeUndefined();
  expect(err.column).toBeUndefined();
});

// Prettier runs as plain JavaScript, so a stack overflow leaves nothing broken behind it.
it('the formatter still formats after an input that was too large or too deeply nested', async () => {
  const source = `<?php\n$a = ${'['.repeat(300)}${']'.repeat(300)};\n`;
  expect((await failureOf(source)).message).toMatch(/too large or too deeply/);
  expect((await formatPhp('<?php echo   1;\n'))?.output).toBe('<?php echo 1;\n');
});

// The three on-or-off options are checked before Prettier runs, and the message uses the label the page shows.
it('a non-boolean useTabs, singleQuote or trailingCommaPHP is refused naming the page label', async () => {
  const labelled = [
    ['useTabs', 'Indent with tabs'],
    ['singleQuote', 'Prefer single quotes'],
    ['trailingCommaPHP', 'Trailing commas'],
  ] as const;
  for (const [name, label] of labelled) {
    for (const bad of [null, 'false', 0, 1, {}, []]) {
      const err = await failureOf('<?php echo 1;\n', { [name]: bad } as unknown as Partial<FormatPhpOptions>);
      expect(err.message).toBe(`${label} must be on or off.`);
      expect(err.line).toBeUndefined();
      expect(err.column).toBeUndefined();
    }
  }
  expect(engineControl.count).toBe(0);

  // A real boolean is accepted, true or false.
  expect(
    (await formatPhp('<?php echo 1;\n', { useTabs: true, singleQuote: true, trailingCommaPHP: false }))?.output,
  ).toBe('<?php echo 1;\n');
});

// Text outside PHP tags is inline HTML to the plugin and comes back as it was, so the folder says so in its limits and
// gives the page a way to tell the visitor.
it('the limits say code must start with <?php and text outside PHP tags is left as it is', () => {
  expect(
    toolMeta.limits.some((l) => l.includes('<?php') && l.includes('treated as HTML') && l.includes('left as it is')),
  ).toBe(true);
});

it('hasPhpOpeningTag is true only when the source contains <?php or <?=', async () => {
  expect(hasPhpOpeningTag('<?php echo 1;\n')).toBe(true);
  expect(hasPhpOpeningTag('<html>\n<?= $x ?>\n</html>')).toBe(true);
  expect(hasPhpOpeningTag('<?PHP echo 1;')).toBe(true);
  expect(hasPhpOpeningTag('echo 1;\n')).toBe(false);
  expect(hasPhpOpeningTag('<div>no tag</div>')).toBe(false);
  expect(hasPhpOpeningTag('')).toBe(false);
  // The case the note is for: code with no opening tag comes back byte for byte.
  expect((await formatPhp('echo   1;\n'))?.output).toBe('echo   1;\n');
});
