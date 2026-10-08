import { expect, it } from 'vitest';
import { resolveEditorConfig } from '../src/index';

/**
 * Expected values in this file come from the EditorConfig specification, version 0.17.2 (https://spec.editorconfig.org/),
 * and from the project's published core tests (editorconfig-core-test), cited next to each test. They are never taken from
 * the page or from this package's own output.
 */

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
