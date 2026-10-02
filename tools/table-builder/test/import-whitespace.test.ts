import { test, expect } from 'vitest';
import { importTable } from '../src/index';

// The HTML Living Standard, 2.4.1 (ASCII white space: tab, line feed, form feed, carriage return, space) and 4.9.9
// (the table model), and the GitHub Flavored Markdown specification 0.29-gfm, section 4.10: a cell's leading and
// trailing white space is trimmed and, in HTML, a run of white space that holds a line break or tab reads as one space.
// These tests pin the behaviour while the trimming and collapsing are done in one linear pass, and prove that a cell
// holding tens of thousands of spaces no longer takes seconds to read.

/** mulberry32: a small, fast, deterministic 32-bit generator. Same seed, same sequence, every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The reading the old regular expressions gave: trim ASCII white space, then one space for a run that holds a break. */
function referenceHtmlCell(text: string): string {
  const ws = '\\t\\n\\f\\r ';
  const trimmed = text.replace(new RegExp(`^[${ws}]+|[${ws}]+$`, 'g'), '');
  return trimmed.replace(new RegExp(`[ ]*[\\t\\n\\f\\r][${ws}]*`, 'g'), ' ');
}

test('an HTML cell has its ends trimmed and each run of white space holding a break read as one space, as before', () => {
  const next = mulberry32(13);
  const alphabet = ['a', 'b', ' ', ' ', '\t', '\n', '\f'];
  for (let n = 0; n < 400; n++) {
    let text = '';
    const length = 1 + Math.floor(next() * 12);
    for (let i = 0; i < length; i++) text += alphabet[Math.floor(next() * alphabet.length)]!;
    const html = `<table><tr><td>${text}</td></tr></table>`;
    expect(importTable(html, 'html').rows, JSON.stringify(text)).toEqual([[referenceHtmlCell(text)]]);
  }
  expect(importTable('<table><tr><td>  a \t\n  b   c  </td></tr></table>', 'html').rows).toEqual([['a b   c']]);
});

test('a Markdown cell has its ends trimmed of spaces and tabs as before', () => {
  const next = mulberry32(29);
  const alphabet = ['a', 'b', ' ', ' ', '\t'];
  for (let n = 0; n < 200; n++) {
    let text = '';
    const length = 1 + Math.floor(next() * 10);
    for (let i = 0; i < length; i++) text += alphabet[Math.floor(next() * alphabet.length)]!;
    const rows = importTable(`| h |\n| --- |\n|${text}|\n`, 'markdown').rows;
    expect(rows, JSON.stringify(text)).toEqual([['h'], [text.replace(/^[ \t]+|[ \t]+$/g, '')]]);
  }
});

test('an HTML cell with 80,000 spaces in the middle of its text is read in well under two seconds', () => {
  const spaces = ' '.repeat(80_000);
  const started = Date.now();
  const rows = importTable(`<table><tr><td>a${spaces}b</td><td>x${spaces}</td></tr></table>`, 'html').rows;
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(rows).toEqual([[`a${spaces}b`, 'x']]);
}, 60_000);

test('a Markdown cell with 80,000 spaces in the middle of its text is read in well under two seconds', () => {
  const spaces = ' '.repeat(80_000);
  const started = Date.now();
  const rows = importTable(`| a${spaces}b | c |\n| --- | --- |\n| 1 | 2 |\n`, 'markdown').rows;
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(rows).toEqual([
    [`a${spaces}b`, 'c'],
    ['1', '2'],
  ]);
}, 60_000);

test('an HTML cell with 80,000 tabs and line breaks in a row is read as one space in well under two seconds', () => {
  const breaks = '\t\n'.repeat(40_000);
  const started = Date.now();
  const rows = importTable(`<table><tr><td>a${breaks}b</td></tr></table>`, 'html').rows;
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(rows).toEqual([['a b']]);
}, 60_000);
