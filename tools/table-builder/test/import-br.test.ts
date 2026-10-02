import { test, expect } from 'vitest';
import { buildTable, importTable } from '../src/index';

// The HTML Living Standard, 15.3.1 (rendering, hidden elements) and the rendering of a line break: a br ends the line
// it follows and starts a new one only if something follows it on that line, so `a<br>` is one line, `a<br><br>` is a
// line and an empty line, and `<br>a` is an empty line and a line.

function html(cell: string): string[][] {
  return importTable(`<table><tr><td>${cell}</td><td>x</td></tr></table>`, 'html').rows;
}

test('a br that ends an HTML cell does not leave a stray line break, and a br between or before text still does', () => {
  expect(html('a<br>')).toEqual([['a', 'x']]);
  expect(html('a<br> ')).toEqual([['a', 'x']]);
  expect(html('a<br></b>')).toEqual([['a', 'x']]);
  expect(html('<p>a<br></p>')).toEqual([['a', 'x']]);
  expect(html('a<br><br>')).toEqual([['a\n', 'x']]);
  expect(html('<br>a')).toEqual([['\na', 'x']]);
  expect(html('a<br>b')).toEqual([['a\nb', 'x']]);
  expect(html('a<br/>b<br>c')).toEqual([['a\nb\nc', 'x']]);
  expect(html('<br>')).toEqual([['', 'x']]);
});

test('a cell that ended in a br exports to TSV, where a stray line break would be refused', () => {
  const imported = importTable('<table><tr><td>a<br></td></tr></table>', 'html').rows;
  expect(buildTable(imported, { format: 'tsv' }).output).toBe('a');
});
