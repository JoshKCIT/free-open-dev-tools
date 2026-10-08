import { expect, it, vi } from 'vitest';
import {
  EditorConfigError,
  MAX_FILES,
  WORK_BUDGET,
  compileGlob,
  matchGlob,
  newBudget,
  parseEditorConfig,
  resolveEditorConfig,
  resolveProperties,
  splitFiles,
} from '../src/index';
import { MAX_SCALING_RATIO, scalingRatio } from './scaling';

/**
 * Limits, refusals and hostile input. The limits are the ones the EditorConfig specification, version 0.17.2, says every core
 * must accept (a section name of 1,024 characters, a key of 1,024 and a value of 4,096, core tests min_supported_*) and the
 * caps this page adds so no paste can keep the tab busy. A refusal names a file and a line and never repeats pasted text.
 */

const BACKSLASH = String.fromCharCode(92);
const MARKER = 'ZQXMARKERZQX';

/** Runs something that must be refused and returns the refusal. */
function refusal(run: () => unknown): EditorConfigError {
  try {
    run();
  } catch (err) {
    if (err instanceof EditorConfigError) return err;
    throw err;
  }
  throw new Error('expected a refusal and got an answer');
}

const comments = (lines: number): string => Array.from({ length: lines }, () => '#').join('\n');

it('a section name of 1,024, a key of 1,024 and a value of 4,096 characters are read and one more is refused naming the file and line', () => {
  // Core tests min_supported_section_name_length, min_supported_key_length and min_supported_value_length (parser/limits.in)
  // and the specification: "Cores must accept keys and values with lengths up to and including 1024 and 4096 characters".
  const name = 'a'.repeat(1024);
  const key = 'k'.repeat(1024);
  const value = 'v'.repeat(4096);
  const ok = resolveEditorConfig(`[${name}]\n${key} = ${value}`, name);
  expect(ok.properties).toHaveLength(1);
  expect(ok.properties[0]).toMatchObject({ key, value, line: 2, section: name });

  const longName = refusal(() => resolveEditorConfig(`[${'a'.repeat(1025)}]\nk = v`, 'a'));
  expect(longName).toMatchObject({ file: 'File 1', line: 1 });
  expect(longName.message).toBe(
    'File 1, line 1: the section name is 1,025 characters long and this page reads names of at most 1,024.',
  );
  const longKey = refusal(() => resolveEditorConfig(`[*]\n${'k'.repeat(1025)} = v`, 'a'));
  expect(longKey).toMatchObject({ file: 'File 1', line: 2 });
  expect(longKey.message).toContain('the key is 1,025 characters long');
  const longValue = refusal(() => resolveEditorConfig(`[*]\nk = ${'v'.repeat(4097)}`, 'a'));
  expect(longValue).toMatchObject({ file: 'File 1', line: 2 });
  expect(longValue.message).toContain('the value is 4,097 characters long');

  // The file and line are the file's own: a problem in the second file is File 2 and counts from its first line.
  const second = refusal(() =>
    resolveEditorConfig(`[*]\nk = v\n=== src ===\n# a comment\n${'k'.repeat(1025)} = v`, 'src/a.txt'),
  );
  expect(second).toMatchObject({ file: 'File 2', line: 2 });

  // Characters are counted, not UTF-16 units: 1,024 characters outside the basic plane are read and 1,025 are refused.
  const astral = String.fromCodePoint(0x1f600);
  const wide = resolveEditorConfig(`[*]\n${astral.repeat(1024)} = v`, 'a');
  expect(wide.properties).toHaveLength(1);
  expect(refusal(() => resolveEditorConfig(`[*]\n${astral.repeat(1025)} = v`, 'a')).line).toBe(2);

  // The same limits hold when a file is read by itself.
  expect(parseEditorConfig(`[${name}]`).sections).toHaveLength(1);
  expect(() => parseEditorConfig(`[${'a'.repeat(1025)}]`)).toThrow(EditorConfigError);

  // A name is also checked where it is compiled, so even a caller that skips the parser cannot make the compiler recurse
  // through an endless run of braces: names of up to 2,048 UTF-16 units (1,024 characters outside the basic plane) are read.
  expect(compileGlob('a'.repeat(2048)).instructions.length).toBeGreaterThan(2048);
  expect(compileGlob('{'.repeat(1024) + '}'.repeat(1024)).instructions.length).toBeGreaterThan(0);
  const tooLong = refusal(() => compileGlob(MARKER + 'a'.repeat(2048)));
  expect(tooLong.message).toBe('A section name is longer than this page reads: at most 1,024 characters.');
  expect(tooLong.message).not.toContain(MARKER);
});

it('folder separator lines are read and a folder with a leading slash, a dot segment or a backslash is refused', () => {
  const files = splitFiles(
    ['[*]', 'a = 1', '=== src ===', '[*]', 'b = 2', '===src/lib===', '[*]', 'c = 3', '==== docs ====', 'd = 4'].join(
      '\n',
    ),
  );
  expect(files.map((f) => [f.number, f.folder, f.label, f.firstLine])).toEqual([
    [1, '', '.editorconfig', 1],
    [2, 'src', 'src/.editorconfig', 4],
    [3, 'src/lib', 'src/lib/.editorconfig', 7],
    [4, 'docs', 'docs/.editorconfig', 10],
  ]);
  // The text before the first folder line is the top file only when it holds something.
  expect(splitFiles('=== src ===\n[*]\nk = v').map((f) => f.label)).toEqual(['src/.editorconfig']);
  expect(splitFiles('\n  \n=== src ===\n[*]').map((f) => f.label)).toEqual(['src/.editorconfig']);
  expect(splitFiles('# only a comment\n=== src ===').map((f) => f.label)).toEqual([
    '.editorconfig',
    'src/.editorconfig',
  ]);
  // A line with fewer than three equals signs on a side, or text after them, is an ordinary line.
  expect(splitFiles('[*]\n== src ==\nk = v').map((f) => f.label)).toEqual(['.editorconfig']);

  const bad: Array<[string, string]> = [
    ['=== /src ===', 'start with a slash'],
    ['=== ./src ===', 'a . or .. part'],
    ['=== src/../lib ===', 'a . or .. part'],
    ['=== .. ===', 'a . or .. part'],
    ['=== src//lib ===', 'an empty part'],
    ['=== src/ ===', 'an empty part'],
    [`=== src${BACKSLASH}lib ===`, 'never a backslash'],
    ['=== ===', 'no folder name'],
    [`=== ${'d'.repeat(1025)} ===`, 'at most 1,024'],
  ];
  // A line made only of equals signs (a decorative rule some hand-written files carry) is no folder line: the reference
  // cores read it as a pair with an empty key and skip it, so it stays in its file and is listed as a skipped line.
  for (const rule of ['=======', '   ==========   ']) {
    const paste = `[*]\nk = v\n${rule}\n[*]\nm = w`;
    expect(splitFiles(paste).map((f) => f.label)).toEqual(['.editorconfig']);
    const ruled = resolveEditorConfig(paste, 'a.js');
    expect(ruled.properties.map((p) => [p.key, p.value])).toEqual([
      ['k', 'v'],
      ['m', 'w'],
    ]);
    expect(ruled.problems.map((p) => [p.file, p.line])).toEqual([['.editorconfig', 3]]);
  }
  for (const [line, part] of bad) {
    const error = refusal(() => splitFiles(`[*]\nk = v\n${line}\n[*]`));
    expect(error.line, line.slice(0, 20)).toBe(3);
    expect(error.file).toBeUndefined();
    expect(error.message, line.slice(0, 20)).toContain('Line 3 of the paste: ');
    expect(error.message, line.slice(0, 20)).toContain(part);
  }
  // A folder of exactly 1,024 characters is read, and the same folder twice is refused.
  expect(splitFiles(`=== ${'d'.repeat(1024)} ===`)[0]?.folder).toBe('d'.repeat(1024));
  expect(refusal(() => splitFiles('=== src ===\n=== src ===')).message).toBe(
    'Line 2 of the paste: a folder is given twice; give the file of each folder once.',
  );
});

it('an empty paste or path gives nothing and a path the page cannot match is refused', () => {
  expect(resolveEditorConfig('', '').empty).toBe(true);
  const refused: Array<[string, string]> = [
    ['/a.js', 'cannot start with a slash'],
    ['a//b.js', 'an empty part'],
    ['a/b/', 'an empty part'],
    ['./a.js', 'a . or .. part'],
    ['a/./b.js', 'a . or .. part'],
    ['../a.js', 'a . or .. part'],
    ['a/../b.js', 'a . or .. part'],
  ];
  for (const [path, part] of refused) {
    const message = refusal(() => resolveEditorConfig('[*]\nk = v', path)).message;
    expect(message, path).toMatch(/^The path /);
    expect(message, path).toContain(part);
  }
  // A backslash is an ordinary character, with a note.
  const result = resolveEditorConfig('[*]\nk = v', `a${BACKSLASH}b.js`);
  expect(result.properties).toHaveLength(1);
  expect(result.notes.join(' ')).toContain('backslash');
  // White space at the start or end of the path is matched as written too, with a note that explains an empty answer.
  for (const spaced of ['src/a.js ', ' src/a.js', `src/a.js${String.fromCharCode(9)}`]) {
    const answer = resolveEditorConfig('[src/*.js]\nk = v', spaced);
    expect(answer.properties, JSON.stringify(spaced)).toEqual([]);
    expect(answer.notes.join(' '), JSON.stringify(spaced)).toContain(
      'The path starts or ends with white space. It is matched as written',
    );
  }
  const plain = resolveEditorConfig('[src/*.js]\nk = v', 'src/a b.js');
  expect(plain.properties).toHaveLength(1);
  expect(plain.notes.join(' ')).not.toContain('white space');
});

it('a paste whose matching would exceed the work budget is refused in plain words', () => {
  // Each section tried against the path costs its instruction count times the path length plus one; 5,000 sections of
  // `*.js` (nine instructions) against a path of 1,023 characters cost about 46 million, over the 40,000,000 budget.
  const text = '[*.js]\n'.repeat(5000);
  const path = `${'a'.repeat(1020)}.js`;
  const error = refusal(() => resolveEditorConfig(text, path));
  expect(error.message).toContain('work budget of 40,000,000');
  expect(error.message).toContain('more work than this page allows');
  expect(error.file).toBe('File 1');
  expect(error.line).toBeGreaterThan(1);
  // The same file with half the sections is answered.
  const half = resolveEditorConfig(`${'[*.js]\n'.repeat(2000)}k = v`, path);
  expect(half.sectionsMatched).toHaveLength(2000);

  // The budget is exact: a cost equal to what is left is paid, one more is refused, and a refusal takes nothing.
  const program = compileGlob('*.js');
  const cost = program.weight * ('a.js'.length + 1);
  const exact = newBudget(cost);
  expect(matchGlob(program, 'a.js', exact)).toBe(true);
  expect(exact.remaining).toBe(0);
  const short = newBudget(cost - 1);
  expect(() => matchGlob(program, 'a.js', short)).toThrow(/work budget/);
  expect(short.remaining).toBe(cost - 1);
  expect(WORK_BUDGET).toBe(40_000_000);

  // The budget is shared by every section of one resolution and fresh for the next one.
  const small = newBudget(cost * 2);
  const files = splitFiles('[*.js]\n[*.js]\n[*.js]\nk = v');
  expect(() => resolveProperties(files, 'a.js', small)).toThrow(EditorConfigError);
  expect(resolveEditorConfig('[*.js]\n[*.js]\n[*.js]\nk = v', 'a.js').sectionsMatched).toHaveLength(3);
});

it('more than 50 files, 10,000 lines or 1,000,000 characters are refused before parsing', () => {
  // Every paste below also holds a key of 1,025 characters, which parsing would refuse: the refusal that comes back is the
  // limit of the paste, so the paste was cut and counted before any file was read.
  const trap = `[*]\n${'k'.repeat(1025)} = v\n`;
  const folders = (n: number): string => Array.from({ length: n }, (_, i) => `=== d${i} ===\n[*]`).join('\n');

  // Files: the top file and 49 folders are 50 files and are read; one more is refused.
  const fifty = resolveEditorConfig(`[*]\nk = v\n${folders(MAX_FILES - 1)}`, 'x.txt');
  expect(fifty.filesUsed).toHaveLength(1);
  expect(fifty.filesNotUsed).toHaveLength(49);
  const many = refusal(() => resolveEditorConfig(`${trap}${folders(MAX_FILES)}`, 'x.txt'));
  expect(many.message).toBe('The paste holds more than 50 files and this page reads at most 50.');

  // Lines: 10,000 are read (a line end after the last one is not another line), 10,001 are refused.
  expect(resolveEditorConfig(comments(10_000), 'a.txt').empty).toBe(false);
  expect(resolveEditorConfig(comments(10_000) + '\n', 'a.txt').empty).toBe(false);
  const lines = refusal(() => resolveEditorConfig(`${trap}${comments(10_000)}`, 'a.txt'));
  expect(lines.message).toBe('The paste holds more than 10,000 lines and this page reads at most 10,000.');

  // Characters: exactly 1,000,000 are read, one more is refused.
  const block = `#${'x'.repeat(4998)}\n`;
  const exactly = block.repeat(200);
  expect(exactly.length).toBe(1_000_000);
  expect(resolveEditorConfig(exactly, 'a.txt').filesUsed).toHaveLength(1);
  const chars = refusal(() => resolveEditorConfig(`${trap}${exactly}`, 'a.txt'));
  expect(chars.message).toBe(`The paste is 1,001,034 characters long and this page reads at most 1,000,000.`);
  expect(trap.length + exactly.length).toBe(1_001_034);
  expect(refusal(() => resolveEditorConfig(exactly + 'x', 'a.txt')).message).toContain('1,000,001 characters');

  // A line: 8,192 characters are read, 8,193 are refused naming file and line. A byte order mark at the start of the paste is
  // no part of the first line (core test bom_at_head reads a file that starts with one).
  expect(resolveEditorConfig(`#${'x'.repeat(8191)}`, 'a.txt').empty).toBe(false);
  expect(resolveEditorConfig(`${String.fromCodePoint(0xfeff)}#${'x'.repeat(8191)}`, 'a.txt').empty).toBe(false);
  const long = refusal(() => resolveEditorConfig(`[*]\n#${'x'.repeat(8192)}`, 'a.txt'));
  expect(long).toMatchObject({ file: 'File 1', line: 2 });
  expect(long.message).toBe(
    'File 1, line 2: the line is 8,193 characters long and this page reads lines of at most 8,192.',
  );

  // The path: 1,024 characters are read, 1,025 are refused.
  expect(resolveEditorConfig('[*]\nk = v', 'a'.repeat(1024)).properties).toHaveLength(1);
  expect(refusal(() => resolveEditorConfig(`${trap}`, 'a'.repeat(1025))).message).toBe(
    'The path is 1,025 characters long and this page reads paths of at most 1,024.',
  );
});

it('refusals name a file and line and never repeat pasted text', () => {
  const messages: string[] = [];
  const keep = (run: () => unknown, check: (e: EditorConfigError) => void): void => {
    const error = refusal(run);
    messages.push(error.message, error.reason);
    check(error);
  };
  const inFile = (file: string, line: number) => (e: EditorConfigError) => {
    expect(e.file).toBe(file);
    expect(e.line).toBe(line);
    expect(e.message).toContain(`${file}, line ${line}: `);
  };
  const onPasteLine = (line: number) => (e: EditorConfigError) => {
    expect(e.file).toBeUndefined();
    expect(e.line).toBe(line);
    expect(e.message).toContain(`Line ${line} of the paste: `);
  };
  const none = (e: EditorConfigError) => {
    expect(e.file).toBeUndefined();
    expect(e.line).toBeUndefined();
  };

  keep(() => resolveEditorConfig(`[*]\n${MARKER}${'k'.repeat(1025)} = v`, 'a'), inFile('File 1', 2));
  keep(() => resolveEditorConfig(`[*]\nk = ${MARKER}${'v'.repeat(4096)}`, 'a'), inFile('File 1', 2));
  keep(() => resolveEditorConfig(`[${MARKER}${'a'.repeat(1030)}]`, 'a'), inFile('File 1', 1));
  keep(() => resolveEditorConfig(`[*]\n# ${MARKER}${'x'.repeat(8200)}`, 'a'), inFile('File 1', 2));
  keep(
    () => resolveEditorConfig(`[*]\nk = v\n=== src ===\n# ${MARKER}${'x'.repeat(8200)}`, 'src/a'),
    inFile('File 2', 1),
  );
  keep(() => resolveEditorConfig(`[*]\n[{1..1234567890}${MARKER}]\nk = v`, 'a'), inFile('File 1', 2));
  keep(() => resolveEditorConfig('[*]', `/${MARKER}`), none);
  keep(() => resolveEditorConfig('[*]', `a//${MARKER}`), none);
  keep(() => resolveEditorConfig('[*]', `${MARKER}/..`), none);
  keep(() => resolveEditorConfig('[*]', `${MARKER}${'a'.repeat(1030)}`), none);
  keep(() => resolveEditorConfig(`[*]\n=== /${MARKER} ===`, 'a'), onPasteLine(2));
  keep(() => resolveEditorConfig(`[*]\n=== ${MARKER}/../x ===`, 'a'), onPasteLine(2));
  keep(() => resolveEditorConfig(`[*]\n=== ${MARKER}${BACKSLASH}x ===`, 'a'), onPasteLine(2));
  keep(() => resolveEditorConfig(`[*]\n=== ${MARKER}//x ===`, 'a'), onPasteLine(2));
  keep(() => resolveEditorConfig(`=== ${MARKER} ===\n=== ${MARKER} ===`, 'a'), onPasteLine(2));
  keep(() => resolveEditorConfig(`[*]\n=== ${MARKER}${'d'.repeat(1030)} ===`, 'a'), onPasteLine(2));
  // The section that runs the budget out is the first one whose cost the rest cannot pay: its line is known from the cost.
  const sectionCost = compileGlob('*.js').weight * (`${'a'.repeat(1020)}.js`.length + 1);
  keep(
    () => resolveEditorConfig(`${'[*.js]\n'.repeat(5000)}# ${MARKER}`, `${'a'.repeat(1020)}.js`),
    inFile('File 1', Math.floor(WORK_BUDGET / sectionCost) + 1),
  );
  for (const text of messages) expect(text).not.toContain(MARKER);

  // A line the format has no place for is skipped with a fixed sentence that does not repeat it.
  const skipped = resolveEditorConfig(`[*]\nthis is ${MARKER} and has no equals sign\n= ${MARKER}\nk = v`, 'a');
  expect(skipped.problems).toHaveLength(2);
  for (const problem of skipped.problems) expect(problem.message).not.toContain(MARKER);
  expect(JSON.stringify(skipped.notes)).not.toContain(MARKER);
});

it('section, key and folder names __proto__, constructor and toString are plain text', () => {
  const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  const text = [
    ...names.flatMap((name) => [`[${name}]`, `${name} = ${name}-value`]),
    ...names.flatMap((name) => [`=== ${name} ===`, '[*]', `${name} = in-folder`]),
  ].join('\n');
  // Section names: only the section named like the path applies.
  const section = resolveEditorConfig(text, '__proto__');
  expect(section.sectionsMatched.map((s) => s.section)).toEqual(['__proto__']);
  expect(section.properties.map((p) => [p.key, p.value])).toEqual([['__proto__', '__proto__-value']]);
  expect(section.properties[0]?.how).toBe('set');
  // Keys: all five come back as keys, lower-cased, in order; none reached a prototype.
  const keys = resolveEditorConfig(
    names.flatMap((name) => [`[${name}]`, `${name} = a`]).join('\n') +
      '\n[*]\n__proto__ = x\nconstructor = y\ntostring = z',
    'toString',
  );
  expect(keys.properties.map((p) => p.key)).toEqual(['tostring', '__proto__', 'constructor']);
  expect(keys.properties.map((p) => p.value)).toEqual(['z', 'x', 'y']);
  // Folders: files for folders named like Object members are used for paths below them.
  const folder = resolveEditorConfig(text, 'constructor/toString/hasOwnProperty/a.txt');
  expect(folder.filesUsed.map((f) => f.label)).toEqual(['.editorconfig', 'constructor/.editorconfig']);
  expect(folder.properties.find((p) => p.key === 'constructor')).toMatchObject({
    value: 'in-folder',
    file: 'constructor/.editorconfig',
  });
  const deep = resolveEditorConfig(
    '[*]\nk = 1\n=== toString ===\n[*]\nk = 2\n=== toString/constructor ===\n[*]\nk = 3',
    'toString/constructor/__proto__',
  );
  expect(deep.properties[0]).toMatchObject({ value: '3', file: 'toString/constructor/.editorconfig' });
  // Nothing was added to Object.prototype and the results have ordinary prototypes.
  expect(Object.keys(Object.prototype)).toEqual([]);
  expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  expect(Object.getPrototypeOf(section.properties[0])).toBe(Object.prototype);
  expect(Object.getPrototypeOf(section)).toBe(Object.prototype);
});

it('the package prints nothing', () => {
  const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
  try {
    resolveEditorConfig('[*.js]\nk = v\n=== src ===\nstray', 'src/a.js');
    expect(() => resolveEditorConfig('[*]\n=== /x ===', 'a')).toThrow();
    expect(() => resolveEditorConfig('[*]', '/a')).toThrow();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

const median = (values: number[]): number => [...values].sort((x, y) => x - y)[1] as number;

/**
 * Times a function on inputs of size n, 2n and 4n. The doubling rule (over 6 fails) does not catch quadratic growth by
 * itself, so an input four times as long is judged against a limit of 12 too; each is the median of three measurements.
 */
function expectLinear(label: string, run: (input: string) => unknown, make: (n: number) => string, n: number): void {
  const doublings: number[] = [];
  const fourfold: number[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = scalingRatio(run, make, n);
    const second = scalingRatio(run, make, 2 * n);
    doublings.push(first);
    fourfold.push(first * second);
  }
  expect(Number.isFinite(median(doublings)), label).toBe(true);
  expect(median(doublings), label).toBeLessThanOrEqual(MAX_SCALING_RATIO);
  expect(median(fourfold), label).toBeLessThanOrEqual(12);
}

it('every parser stays linear on hostile input', () => {
  // Texts of many lines, up to 20,000 characters (inputs of 5,000 and 10,000 and their doubles).
  const manyLines: Array<[string, (n: number) => string]> = [
    ['blank lines', (n) => '\n'.repeat(n)],
    ['empty sections', (n) => '[a]\n'.repeat(Math.floor(n / 4))],
    ['open brackets', (n) => '[\n'.repeat(Math.floor(n / 2))],
    ['close brackets', (n) => ']\n'.repeat(Math.floor(n / 2))],
    ['equals signs', (n) => '=\n'.repeat(Math.floor(n / 2))],
    ['comments', (n) => ';\n'.repeat(Math.floor(n / 2))],
    ['pairs', (n) => '[*]\n' + 'k = v\n'.repeat(Math.floor(n / 6))],
    ['the same key', (n) => '[*]\n' + 'k = v\n'.repeat(Math.floor(n / 6)) + 'k = w'],
    ['stray lines', (n) => 'no equals here\n'.repeat(Math.floor(n / 15))],
    ['carriage returns', (n) => 'k = v\r'.repeat(Math.floor(n / 6))],
    ['folder lines', (n) => '=== a ===\n[*]\n'.repeat(Math.floor(n / 14))],
    [
      'sections with their own names',
      (n) => Array.from({ length: Math.floor(n / 12) }, (_, i) => `[f${i}]\nk = v`).join('\n'),
    ],
    ['the same section', (n) => '[*.js]\nk = v\n'.repeat(Math.floor(n / 13))],
    ['braces', (n) => '[{a,b}{c,d}]\nk = v\n'.repeat(Math.floor(n / 20))],
  ];
  const runs: Array<[string, (text: string) => unknown]> = [
    ['parse', (text) => parseEditorConfig(text)],
    ['split', (text) => splitFiles(text)],
    ['resolve a nested path', (text) => resolveEditorConfig(text, 'a/b/c.js')],
    ['resolve the top path', (text) => resolveEditorConfig(text, 'f1')],
  ];
  for (const [fn, run] of runs) {
    for (const [name, make] of manyLines) expectLinear(`${fn} ${name}`, run, make, 5000);
  }

  // Single lines. Each size stays under the limit the line is held to (a key or section name of 1,024 characters, a folder of
  // 1,024, a value of 4,096, a line of 8,192): a refusal costs the same few microseconds whatever it refuses, so a size
  // that crossed the limit would time the refusal and not the reading.
  const oneLine: Array<[string, (n: number) => string, number]> = [
    ['a long key', (n) => `${'k'.repeat(n)} = v`, 250],
    ['a long value', (n) => `k = ${'v'.repeat(n)}`, 1000],
    ['equals signs', (n) => '='.repeat(n), 1000],
    ['a long section', (n) => `[${'a'.repeat(n)}]`, 250],
    ['brackets', (n) => '['.repeat(n), 1000],
    ['a folder line', (n) => `=== ${'a/'.repeat(Math.floor(n / 2))}b ===`, 250],
    ['spaces', (n) => ' '.repeat(n) + '!', 1000],
  ];
  for (const [fn, run] of runs) {
    for (const [name, make, size] of oneLine) expectLinear(`${fn} ${name}`, run, make, size);
  }

  // Section names as globs (compiled once each; the longest name read is 1,024 characters, so the sizes stay under 2,048).
  // Names that nest are followed through one call of the compiler per level, so those stay inside the length a page reads; the
  // others are timed on names far longer than that, through the compiler's own length argument, so that a rescan per
  // character shows up even though a page never hands the compiler more than 1,024 characters.
  const deepGlobs: Array<[string, (n: number) => string]> = [
    ['nested braces', (n) => '{'.repeat(Math.floor(n / 2)) + '}'.repeat(Math.floor(n / 2))],
    ['nested choices', (n) => '{a,'.repeat(Math.floor(n / 3)) + '}'.repeat(Math.floor(n / 3))],
  ];
  for (const [name, make] of deepGlobs) expectLinear(`compile ${name}`, (glob) => compileGlob(glob), make, 250);
  const globs: Array<[string, (n: number) => string]> = [
    ['opening braces', (n) => '{'.repeat(n)],
    ['closing braces', (n) => '}'.repeat(n)],
    ['commas inside braces', (n) => '{' + ','.repeat(n) + '}'],
    ['many choices', (n) => '{a,b}'.repeat(Math.floor(n / 5))],
    ['opening brackets', (n) => '['.repeat(n)],
    ['half open classes', (n) => '[a'.repeat(Math.floor(n / 2))],
    ['escaped brackets', (n) => `[${BACKSLASH}]`.repeat(Math.floor(n / 3))],
    ['backslashes', (n) => BACKSLASH.repeat(n)],
    ['stars', (n) => '*'.repeat(n)],
    ['double stars between slashes', (n) => '**/'.repeat(Math.floor(n / 3))],
    ['number ranges', (n) => '{1..9}'.repeat(Math.floor(n / 6))],
    ['question marks', (n) => '?'.repeat(n)],
  ];
  for (const [name, make] of globs) {
    expectLinear(`compile ${name}`, (glob) => compileGlob(glob, '', 1_000_000), make, 5000);
  }

  // Many files of the same kind and the numbers a visitor can reach: all 50 files at once.
  const fiftyFiles = (n: number): string =>
    Array.from(
      { length: 50 },
      (_, i) => `=== d${i} ===\n` + '[*]\nk = v\n'.repeat(Math.max(1, Math.floor(n / 500))),
    ).join('');
  expectLinear('resolve fifty files', (text) => resolveEditorConfig(text, 'd1/d2/a.txt'), fiftyFiles, 5000);
  // A refusal at a limit costs nothing like reading what was refused.
  expectLinear(
    'refuse a long paste',
    (text) => resolveEditorConfig(text, 'a'),
    (n) => 'a'.repeat(1_000_001 + n),
    1000,
  );
}, 600_000);
