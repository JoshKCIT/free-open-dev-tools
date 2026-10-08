import { expect, it } from 'vitest';
import {
  REASON_ABOVE_ROOT,
  REASON_NOT_ABOVE,
  REASON_NO_MATCH,
  resolveEditorConfig,
  type EditorConfigResult,
  type PropertyRow,
} from '../src/index';

/**
 * Expected values in this file come from the EditorConfig specification, version 0.17.2 (https://spec.editorconfig.org/),
 * and from the project's published core tests (editorconfig-core-test, vendored in test/fixtures/core-test and run in full
 * by core.test.ts), cited next to each test. They are never taken from the page or from this package's own output.
 */

const find = (result: EditorConfigResult, key: string): PropertyRow | undefined =>
  result.properties.find((p) => p.key === key);

// Lines of this file: 1 root, 3 the first section, 4 and 5 its pairs, 7 the second section, 8 its pair.
const TOP_FILE = [
  'root = true',
  '',
  '[*.{js,py}]',
  'indent_style = space',
  'indent_size = 4',
  '',
  '[*.py]',
  'indent_size = 2',
].join('\n');

it('a later section overrides an earlier one and tab_width follows indent_size', () => {
  // Specification 0.17.2, "File Processing": "Files are read top to bottom and the most recent rules found take
  // precedence". The core test tab_width_default (properties/tab_width_default.in) says a number in indent_size with no
  // tab_width gives a tab_width equal to it.
  const py = resolveEditorConfig(TOP_FILE, 'src/app.py');
  expect(py.empty).toBe(false);
  expect(py.properties.map((p) => [p.key, p.value, p.how])).toEqual([
    ['indent_style', 'space', 'set'],
    ['indent_size', '2', 'set'],
    ['tab_width', '2', 'derived'],
  ]);
  const size = py.properties.find((p) => p.key === 'indent_size');
  expect(size).toMatchObject({ file: '.editorconfig', section: '*.py', line: 8 });
  const style = py.properties.find((p) => p.key === 'indent_style');
  expect(style).toMatchObject({ file: '.editorconfig', section: '*.{js,py}', line: 4 });
  const width = py.properties.find((p) => p.key === 'tab_width');
  expect(width).toMatchObject({ from: 'indent_size', section: '*.py', line: 8 });
  expect(py.overridden).toEqual([
    {
      key: 'indent_size',
      value: '4',
      file: '.editorconfig',
      section: '*.{js,py}',
      line: 5,
      byFile: '.editorconfig',
      bySection: '*.py',
      byLine: 8,
    },
  ]);

  // The same file for a .js path: only the first section matches, so indent_size stays 4 and tab_width follows it.
  const js = resolveEditorConfig(TOP_FILE, 'src/app.js');
  expect(js.properties.map((p) => [p.key, p.value])).toEqual([
    ['indent_style', 'space'],
    ['indent_size', '4'],
    ['tab_width', '4'],
  ]);
  expect(js.overridden).toEqual([]);
  expect(js.sectionsMatched.map((s) => s.section)).toEqual(['*.{js,py}']);
});

it('the nearest file with root set to true stops the search and root is read in the preamble only', () => {
  // Specification 0.17.2, "File Processing": the search "shall stop if an EditorConfig file is found with the root key set
  // to true in the preamble"; the key and its value are read without regard to case. Core tests root_file,
  // root_file_mixed_case and root_pattern (filetree/root_file.in).
  const files = [
    '[*]',
    'indent_size = 4',
    'charset = utf-8',
    '=== src ===',
    'root = TRUE',
    '[*.js]',
    'indent_size = 2',
  ].join('\n');
  const stopped = resolveEditorConfig(files, 'src/a.js');
  expect(stopped.properties.map((p) => [p.key, p.value, p.file])).toEqual([
    ['indent_size', '2', 'src/.editorconfig'],
    ['tab_width', '2', 'src/.editorconfig'],
  ]);
  expect(stopped.filesUsed.map((f) => f.label)).toEqual(['src/.editorconfig']);
  expect(stopped.filesNotUsed).toEqual([{ label: '.editorconfig', folder: '', reason: REASON_ABOVE_ROOT }]);
  expect(stopped.sectionsNotMatched).toEqual([
    { file: '.editorconfig', section: '*', line: 1, reason: 'its file is not used' },
  ]);

  // Without root in the nearest file the search goes on to the top file, and the top file's own root line ends it there.
  const open = resolveEditorConfig(
    ['root = true', '[*]', 'charset = utf-8', '=== src ===', '[*.js]', 'indent_size = 2'].join('\n'),
    'src/a.js',
  );
  expect(open.filesUsed.map((f) => f.label)).toEqual(['.editorconfig', 'src/.editorconfig']);
  expect(open.filesNotUsed).toEqual([]);
  expect(open.properties.map((p) => p.key)).toEqual(['charset', 'indent_size', 'tab_width']);

  // A root line inside a section is an ordinary pair: it stops nothing and shows up as a property named root.
  const inSection = resolveEditorConfig(
    ['[*]', 'indent_size = 4', '=== src ===', '[*.js]', 'root = true'].join('\n'),
    'src/a.js',
  );
  expect(inSection.filesUsed.map((f) => f.label)).toEqual(['.editorconfig', 'src/.editorconfig']);
  expect(find(inSection, 'root')).toMatchObject({ value: 'true', file: 'src/.editorconfig', section: '*.js', line: 2 });
  expect(find(inSection, 'indent_size')?.value).toBe('4');

  // A file in a folder that is not above the path is not used, and says why.
  const sibling = resolveEditorConfig(
    ['[*]', 'indent_size = 4', '=== lib ===', '[*]', 'indent_size = 9'].join('\n'),
    'src/a.js',
  );
  expect(find(sibling, 'indent_size')?.value).toBe('4');
  expect(sibling.filesNotUsed).toEqual([{ label: 'lib/.editorconfig', folder: 'lib', reason: REASON_NOT_ABOVE }]);

  // Only the folders of the path count: a file for a folder below the path's own folder is not above it either.
  const below = resolveEditorConfig(['[*]', 'indent_size = 4', '=== src/lib ==='].join('\n'), 'src/a.js');
  expect(below.filesNotUsed.map((f) => f.reason)).toEqual([REASON_NOT_ABOVE]);
});

it('a closer file and a later section win and each property names its file, section and line', () => {
  // Specification 0.17.2: files are read from the farthest to the nearest and the most recent pair takes precedence. Core
  // tests parent_dir_overload and parent_dir_overload_repeat (filetree/parent_directory.in).
  const files = [
    '[*.js]', // 1
    'indent_size = 8', // 2
    'indent_style = tab', // 3
    '', // 4
    '[*.js]', // 5
    'indent_size = 3', // 6
    '=== src ===',
    '[*]', // 1 of the file under src
    'indent_size = 2', // 2
  ].join('\n');
  const result = resolveEditorConfig(files, 'src/a.js');
  expect(result.properties).toEqual([
    { key: 'indent_size', value: '2', how: 'set', file: 'src/.editorconfig', section: '*', line: 2 },
    { key: 'indent_style', value: 'tab', how: 'set', file: '.editorconfig', section: '*.js', line: 3 },
    {
      key: 'tab_width',
      value: '2',
      how: 'derived',
      file: 'src/.editorconfig',
      section: '*',
      line: 2,
      from: 'indent_size',
    },
  ]);
  expect(result.overridden).toEqual([
    {
      key: 'indent_size',
      value: '8',
      file: '.editorconfig',
      section: '*.js',
      line: 2,
      byFile: '.editorconfig',
      bySection: '*.js',
      byLine: 6,
    },
    {
      key: 'indent_size',
      value: '3',
      file: '.editorconfig',
      section: '*.js',
      line: 6,
      byFile: 'src/.editorconfig',
      bySection: '*',
      byLine: 2,
    },
  ]);
  expect(result.sectionsMatched).toEqual([
    { file: '.editorconfig', section: '*.js', line: 1 },
    { file: '.editorconfig', section: '*.js', line: 5 },
    { file: 'src/.editorconfig', section: '*', line: 1 },
  ]);

  // A pair repeated inside one section: the later line wins and the earlier one is listed as replaced.
  const repeated = resolveEditorConfig(['[*]', 'key = one', 'key = two'].join('\n'), 'a.txt');
  expect(repeated.properties).toEqual([
    { key: 'key', value: 'two', how: 'set', file: '.editorconfig', section: '*', line: 3 },
  ]);
  expect(repeated.overridden).toMatchObject([{ key: 'key', value: 'one', line: 2, byLine: 3 }]);

  // A name with no slash outside brackets matches below its file; a name with a slash is relative to its file's folder.
  const scoped = resolveEditorConfig(
    [
      '[*.md]',
      'a = top',
      '=== docs ===',
      '[*.md]',
      'b = any depth',
      '[/x.md]',
      'c = anchored',
      '[guide/x.md]',
      'd = relative',
    ].join('\n'),
    'docs/guide/x.md',
  );
  expect(scoped.properties.map((p) => [p.key, p.value])).toEqual([
    ['a', 'top'],
    ['b', 'any depth'],
    ['d', 'relative'],
  ]);
  expect(scoped.sectionsNotMatched).toEqual([
    { file: 'docs/.editorconfig', section: '/x.md', line: 3, reason: REASON_NO_MATCH },
  ]);
});

it('unset removes the earlier setting and indent_size unset also reports tab_width unset', () => {
  // Specification 0.17.2: a value of unset "removes the effect of that pair, even if it has been set before". The reference
  // cores report the value unset itself: core tests unset_charset, unset_end_of_line, unset_indent_style,
  // unset_insert_final_newline, unset_tab_width and unset_trim_trailing_whitespace, and unset_indent_size_ML, which expects
  // indent_size=unset together with tab_width=unset (filetree/unset.in).
  const files = ['[*]', 'indent_size = 4', 'charset = utf-8', '[*.js]', 'indent_size = unset', 'charset = UNSET'].join(
    '\n',
  );
  const result = resolveEditorConfig(files, 'a.js');
  expect(result.properties.map((p) => [p.key, p.value, p.how])).toEqual([
    ['indent_size', 'unset', 'unset'],
    ['charset', 'unset', 'unset'],
    ['tab_width', 'unset', 'derived'],
  ]);
  expect(result.overridden.map((o) => [o.key, o.value])).toEqual([
    ['indent_size', '4'],
    ['charset', 'utf-8'],
  ]);
  expect(result.notes.join(' ')).toContain('tab_width is reported as unset because indent_size is unset');

  // A later pair can set the property again.
  const again = resolveEditorConfig(['[*]', 'charset = unset', '[*.js]', 'charset = utf-8'].join('\n'), 'a.js');
  expect(find(again, 'charset')).toMatchObject({ value: 'utf-8', how: 'set', line: 4 });
  expect(again.overridden).toMatchObject([{ key: 'charset', value: 'unset' }]);

  // Unset on a different path does not apply, so the earlier value stays.
  const other = resolveEditorConfig(files, 'a.py');
  expect(other.properties.map((p) => [p.key, p.value])).toEqual([
    ['indent_size', '4'],
    ['charset', 'utf-8'],
    ['tab_width', '4'],
  ]);
});

it('known values are lower-cased and every other value keeps its case', () => {
  // Specification 0.17.2: the values of indent_style, indent_size, end_of_line, charset (and the booleans) are read without
  // regard to case; keys are case-insensitive. Core tests lowercase_names and lowercase_values (properties/*.in).
  const files = [
    '[*]',
    'INDENT_STYLE = Space',
    'End_Of_Line = CRLF',
    'charset = UTF-8',
    'insert_final_newline = TRUE',
    'trim_trailing_whitespace = False',
    'indent_size = 4',
    'tab_width = 4',
    'max_line_length = Off',
    'Foo_Bar = KeepCase',
  ].join('\n');
  const result = resolveEditorConfig(files, 'a.txt');
  expect(result.properties.map((p) => [p.key, p.value])).toEqual([
    ['indent_style', 'space'],
    ['end_of_line', 'crlf'],
    ['charset', 'utf-8'],
    ['insert_final_newline', 'true'],
    ['trim_trailing_whitespace', 'false'],
    ['indent_size', '4'],
    ['tab_width', '4'],
    ['max_line_length', 'Off'],
    ['foo_bar', 'KeepCase'],
  ]);
});

it('an empty paste or path gives nothing and a file with no matching section says no property applies', () => {
  // An empty paste or an empty path is nothing to resolve; it is not an error and nothing is read.
  for (const [files, path] of [
    ['', 'a.js'],
    ['[*]\nk = v', ''],
    ['  \n\t\n', 'a.js'],
    ['[*]\nk = v', '   '],
    ['', ''],
  ] as const) {
    const result = resolveEditorConfig(files, path);
    expect(result.empty).toBe(true);
    expect(result.properties).toEqual([]);
    expect(result.filesUsed).toEqual([]);
    expect(result.filesNotUsed).toEqual([]);
    expect(result.sectionsMatched).toEqual([]);
    expect(result.sectionsNotMatched).toEqual([]);
    expect(result.problems).toEqual([]);
  }

  // No section matches: the answer is "no property applies", a result and not an error (specification: a file with no
  // matching section sets nothing).
  const none = resolveEditorConfig(['[*.py]', 'indent_size = 4'].join('\n'), 'a.js');
  expect(none.empty).toBe(false);
  expect(none.properties).toEqual([]);
  expect(none.filesUsed.map((f) => f.label)).toEqual(['.editorconfig']);
  expect(none.sectionsNotMatched).toEqual([
    { file: '.editorconfig', section: '*.py', line: 1, reason: REASON_NO_MATCH },
  ]);

  // A file with only a preamble applies no property, and its root = true is still honoured. Core tests
  // comments_only_editorconfig_file and empty_editorconfig_file give no properties either.
  const preamble = resolveEditorConfig(
    ['[*]', 'indent_size = 9', '=== src ===', 'root = true', 'indent_size = 3'].join('\n'),
    'src/a.js',
  );
  expect(preamble.properties).toEqual([]);
  expect(preamble.filesUsed.map((f) => f.label)).toEqual(['src/.editorconfig']);
  expect(preamble.filesNotUsed).toEqual([{ label: '.editorconfig', folder: '', reason: REASON_ABOVE_ROOT }]);

  // A paste of comments and blank lines only is a file with nothing in it.
  const comments = resolveEditorConfig('# nothing here\n; or here\n\n', 'a.js');
  expect(comments.empty).toBe(false);
  expect(comments.properties).toEqual([]);
  expect(comments.filesUsed).toHaveLength(1);

  // Lines the format has no place for are skipped and reported by file label and line.
  const odd = resolveEditorConfig(['[*]', 'this line has no equals sign', '= no key', 'k = v'].join('\n'), 'a.js');
  expect(odd.properties.map((p) => [p.key, p.value])).toEqual([['k', 'v']]);
  expect(odd.problems.map((p) => [p.file, p.line])).toEqual([
    ['.editorconfig', 2],
    ['.editorconfig', 3],
  ]);
});

it('properties appear in the order they were first set, farthest file first', () => {
  // Properties are listed in the order they were first set, applying files from the farthest to the nearest and sections
  // from top to bottom; a property set again keeps its place (it is the same key). The core test parent_and_current_dir_ML
  // reads two files, the parent's key first.
  const files = ['[*]', 'b = 1', 'a = 2', '=== src ===', '[*]', 'c = 3', 'b = 4'].join('\n');
  const result = resolveEditorConfig(files, 'src/x.txt');
  expect(result.properties.map((p) => [p.key, p.value])).toEqual([
    ['b', '4'],
    ['a', '2'],
    ['c', '3'],
  ]);

  // The lists follow folder depth and line order, whatever order the files were pasted in.
  const pasted = ['[*]', 'k = top', '=== src/lib ===', '[*]', 'k = lib', '=== src ===', '[*]', 'k = src'].join('\n');
  const deep = resolveEditorConfig(pasted, 'src/lib/x.txt');
  expect(deep.filesUsed.map((f) => f.label)).toEqual(['.editorconfig', 'src/.editorconfig', 'src/lib/.editorconfig']);
  expect(deep.sectionsMatched.map((s) => s.file)).toEqual([
    '.editorconfig',
    'src/.editorconfig',
    'src/lib/.editorconfig',
  ]);
  expect(find(deep, 'k')).toMatchObject({ value: 'lib', file: 'src/lib/.editorconfig' });
  expect(deep.overridden.map((o) => o.value)).toEqual(['top', 'src']);
});

it('resolving the same files and path twice gives identical rows', () => {
  const files = [TOP_FILE, '=== src ===', '[*.py]', 'indent_size = 3', 'k = v', '', 'stray line'].join('\n');
  const first = resolveEditorConfig(files, 'src/app.py');
  // Something else is resolved in between, and the first answer is damaged: neither may change the next answer.
  resolveEditorConfig('[*]\nz = 1', 'other.txt');
  first.properties.length = 0;
  first.filesUsed.push({ label: 'x', folder: 'x' });
  const second = resolveEditorConfig(files, 'src/app.py');
  const third = resolveEditorConfig(files, 'src/app.py');
  expect(third).toEqual(second);
  expect(second.properties.length).toBeGreaterThan(0);
  expect(second.filesUsed.map((f) => f.label)).toEqual(['.editorconfig', 'src/.editorconfig']);
  expect(second.problems).toHaveLength(1);
});
