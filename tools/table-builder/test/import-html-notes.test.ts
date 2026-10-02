import { test, expect } from 'vitest';
import { importTable } from '../src/index';

// The HTML Living Standard, 14.3 (the pre element: "a leading newline immediately after the start tag is ignored") and
// 15.3.1 / 15.5.4 (rendering: the content of pre keeps its white space and line breaks; every other cell collapses a
// run of white space to one space) and 4.9.1 (a document can hold any number of table elements).

test('pasted HTML with more than one table reads the first and says how many there were', () => {
  const two = importTable('<table><tr><td>a</td></tr></table><p>between</p><table><tr><td>b</td></tr></table>', 'html');
  expect(two.rows).toEqual([['a']]);
  expect(two.warnings.join(' ')).toContain('2 tables');
  expect(two.warnings.join(' ')).toContain('only the first');

  const three = importTable('<div><table><tr><td>a</td></tr></table></div><table></table><table></table>', 'html');
  expect(three.warnings.join(' ')).toContain('3 tables');

  // One table, even with a table nested in a cell (which has its own warning), is not "more than one table".
  const nested = importTable('<table><tr><td>a<table><tr><td>n</td></tr></table></td></tr></table>', 'html');
  expect(nested.rows).toEqual([['a']]);
  expect(nested.warnings.join(' ')).not.toContain('only the first');
  expect(importTable('<table><tr><td>a</td></tr></table>', 'html').warnings).toEqual([]);
});

test('a pre in an HTML cell keeps its line breaks and spaces and the cell is not reported as collapsed', () => {
  const pre = importTable('<table><tr><td><pre>line 1\n  line 2\n\tline  3</pre></td></tr></table>', 'html');
  expect(pre.rows).toEqual([['line 1\n  line 2\n\tline  3']]);
  expect(pre.warnings).toEqual([]);

  // Blank lines inside stay, the newline right after the start tag and a final newline are not lines of their own.
  expect(importTable('<table><tr><td><pre>\na\n\nb\n</pre></td></tr></table>', 'html').rows).toEqual([['a\n\nb']]);
  // An element inside a pre, and text around it, keep their place; the text outside the pre is collapsed as before.
  expect(importTable('<table><tr><td>x \n y<pre>p <b>q</b>\n r</pre> z</td></tr></table>', 'html').rows).toEqual([
    ['x y\np q\n r\nz'],
  ]);
});

test('white space before a pre, and left over at the end of it, does not join the text beside it', () => {
  expect(importTable('<table><tr><td>\n  <pre>a</pre></td></tr></table>', 'html').rows).toEqual([['a']]);
  expect(importTable('<table><tr><td><pre>a\n   </pre> z</td></tr></table>', 'html').rows).toEqual([['a\nz']]);
});

test('white space outside a pre is still read as one space and still reported', () => {
  const plain = importTable('<table><tr><td>a \n  b</td></tr></table>', 'html');
  expect(plain.rows).toEqual([['a b']]);
  expect(plain.warnings.join(' ')).toContain('one space');
});
