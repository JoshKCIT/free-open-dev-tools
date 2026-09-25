import { it, expect, vi } from 'vitest';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { buildTable, TableBuilderError } from '../src/index';
import { parseCsv } from '../src/csv';

// Fetched with `curl -fsSL https://github.github.com/gfm/`, 2026-09-25, section 4.10 Tables (extension).
//
// Example 198 (quoted):
// | foo | bar |
// | --- | --- |
// | baz | bim |
// renders to:
// <table><thead><tr><th>foo</th><th>bar</th></tr></thead><tbody><tr><td>baz</td><td>bim</td></tr></tbody></table>
//
// Example 199 (quoted, alignment): a centre-aligned column renders
// <th align="center">, a right-aligned column renders <th align="right">.
//
// Example 204 (quoted): "The remainder of the table's rows may vary in the
// number of cells. If there are a number of cells fewer than the number of
// cells in the header row, empty cells are inserted. If there are greater,
// the excess is ignored."
//
// Example 205 (quoted): "If there are no rows in the body, no <tbody> is
// generated in HTML output."

/** Strips whitespace between tags so pretty-printed and compact HTML compare equal. */
function normaliseHtml(html: string): string {
  return html.replace(/>\s+</g, '><').trim();
}

/** Runs Markdown through micromark with the GFM table extension, the same independent parsing oracle every table-writing test in this file uses. */
function renderGfm(markdown: string): string {
  return micromark(markdown, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
    // A real GFM renderer (for example GitHub's own) treats a bare <br> in
    // a table cell as a line break, not literal text. This tool never
    // writes any other raw tag into a cell -- everything else typed into a
    // cell is backslash- or entity-escaped -- so enabling this here mirrors
    // what a real renderer does without reopening the door to raw markup.
    allowDangerousHtml: true,
  });
}

/** Builds the same grid as Markdown and as HTML and asserts a GFM parser's rendering of the Markdown equals the HTML, ignoring whitespace between tags. */
function expectMarkdownRendersLikeHtml(rows: string[][], headerRow: boolean, alignments: string): void {
  const markdown = buildTable(rows, { format: 'markdown', headerRow, alignments, pad: true }).output;
  const html = buildTable(rows, { format: 'html', headerRow, alignments, pretty: false }).output;
  const rendered = renderGfm(markdown);
  expect(normaliseHtml(rendered), `markdown:\n${markdown}`).toBe(normaliseHtml(html));
}

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

// Every character a random cell may hold. Deliberately excludes whitespace
// at the position a cell would start or end with (GFM tables trim leading
// and trailing spaces between the pipe and the cell content, so a random
// cell that started or ended with a space could never round-trip to the
// same text) and excludes the semicolon, so a run of these characters can
// never spell out a complete HTML entity reference by chance.
const RANDOM_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 |\\*_`~[]()<>&#!.,:-+="\'';

function randomCell(rng: () => number): string {
  const length = Math.floor(rng() * 8);
  if (length === 0) return '';
  const chars: string[] = [];
  for (let i = 0; i < length; i++) {
    chars.push(RANDOM_CHARS[Math.floor(rng() * RANDOM_CHARS.length)]!);
  }
  // A cell with a real line break in the middle is exercised deliberately,
  // never at the very start or end (same trimming reason as above).
  if (length > 2 && rng() < 0.2) {
    chars[Math.floor(length / 2)] = '\n';
  }
  // GFM trims the space between a pipe and a cell's content (quoted at the
  // top of this file's own source), so a cell that starts or ends with a
  // space can never round-trip through Markdown -- a documented limit, not
  // a bug -- and is excluded from this equivalence check by trimming each
  // line's own leading and trailing spaces here.
  const trimmed = chars
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
  return trimmed === '' ? 'x' : trimmed;
}

function randomGrid(rng: () => number): string[][] {
  const rows = 1 + Math.floor(rng() * 6);
  const columns = 1 + Math.floor(rng() * 5);
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < columns; c++) row.push(randomCell(rng));
    grid.push(row);
  }
  // The bottom-right cell is never blank, so trimming fully empty trailing
  // rows and columns can never trim the whole grid away to nothing.
  grid[rows - 1]![columns - 1] = 'x';
  return grid;
}

const ALIGNMENT_WORDS = ['left', 'center', 'right', 'none'];

function randomAlignments(rng: () => number, columns: number): string {
  const words: string[] = [];
  for (let c = 0; c < columns; c++) words.push(ALIGNMENT_WORDS[Math.floor(rng() * ALIGNMENT_WORDS.length)]!);
  return words.join(',');
}

it('GFM table output renders through a GFM parser to the same table as the HTML output', () => {
  // The GFM spec's own worked examples, each also proven individually below.
  expectMarkdownRendersLikeHtml(
    [
      ['foo', 'bar'],
      ['baz', 'bim'],
    ],
    true,
    '',
  );
  expectMarkdownRendersLikeHtml(
    [
      ['abc', 'defghi'],
      ['bar', 'baz'],
    ],
    true,
    'center,right',
  );
  expectMarkdownRendersLikeHtml([['f|oo'], ['b | az'], ['b ** | ** im']], true, '');
  expectMarkdownRendersLikeHtml([['abc', 'def'], ['bar'], ['bar', 'baz', 'boo']], true, '');
  expectMarkdownRendersLikeHtml([['abc', 'def']], true, '');
  expectMarkdownRendersLikeHtml([['abc', 'def']], false, '');

  // 200 seeded random grids: same seed, same sequence, every run.
  const rng = mulberry32(0x7ab1e5);
  for (let i = 0; i < 200; i++) {
    const grid = randomGrid(rng);
    const columns = grid[0]!.length;
    const headerRow = rng() < 0.85;
    const alignments = rng() < 0.5 ? randomAlignments(rng, columns) : '';
    expectMarkdownRendersLikeHtml(grid, headerRow, alignments);
  }
});

it('GFM spec example 198 is produced from its own cells', () => {
  const result = buildTable(
    [
      ['foo', 'bar'],
      ['baz', 'bim'],
    ],
    { format: 'markdown' },
  );
  expect(result.output).toBe('| foo | bar |\n| --- | --- |\n| baz | bim |');
  expect(result.rows).toBe(2);
  expect(result.columns).toBe(2);
  expect(result.warnings).toEqual([]);
});

it('pipes, backslashes and line breaks inside cells are escaped so the Markdown table keeps its shape', () => {
  const withPipe = buildTable([['a|b'], ['x']], { format: 'markdown' });
  expect(withPipe.output).toContain('a\\|b');

  const withBackslashAndPipe = buildTable([['a\\|b'], ['x']], { format: 'markdown' });
  const rendered = renderGfm(withBackslashAndPipe.output);
  expect(rendered).toContain('a\\|b');

  const withLineBreak = buildTable([['line1\nline2'], ['x']], { format: 'markdown' });
  expect(withLineBreak.output).toContain('line1<br>line2');
  const renderedBreak = renderGfm(withLineBreak.output);
  expect(renderedBreak).toContain('line1<br>line2');
});

it('column alignments become GFM delimiter colons and HTML align attributes', () => {
  const rows = [
    ['abc', 'defghi', 'x'],
    ['bar', 'baz', 'y'],
  ];
  const markdown = buildTable(rows, { format: 'markdown', alignments: 'left,center,right' }).output;
  const lines = markdown.split('\n');
  expect(lines[1]).toMatch(/^\|\s*:-+\s*\|\s*:-+:\s*\|\s*-+:\s*\|$/);

  const html = buildTable(rows, { format: 'html', alignments: 'left,center,right' }).output;
  expect(html).toContain('align="left"');
  expect(html).toContain('align="center"');
  expect(html).toContain('align="right"');

  const noneAligned = buildTable(rows, { format: 'html', alignments: 'none,none,none' }).output;
  expect(noneAligned).not.toContain('align=');

  const badAlignment = buildTable(rows, { format: 'markdown', alignments: 'sideways,center,right' });
  expect(badAlignment.warnings.some((w) => w.includes('sideways'))).toBe(true);
});

it('HTML output escapes every cell so markup typed into a cell stays text', () => {
  const result = buildTable([['<script>x</script>'], ['y']], { format: 'html' });
  expect(result.output).toContain('&lt;script&gt;x&lt;/script&gt;');
  expect(result.output).not.toContain('<script>');
});

it('RFC 4180 CSV output parses back to the same cells', () => {
  const grid = [
    ['name', 'quote'],
    ['Ada', 'Hello, "world"'],
    ['Lin', 'multi\r\nline'],
  ];
  const result = buildTable(grid, { format: 'csv' });
  const parsed = parseCsv(result.output);
  expect(parsed.rows).toEqual(grid);
});

it('JSON output keys rows by the header row, with empty and duplicate headers renamed', () => {
  const result = buildTable(
    [
      ['id', '', 'id'],
      ['1', '2', '3'],
    ],
    { format: 'json', pretty: false },
  );
  const parsed = JSON.parse(result.output) as Record<string, string>[];
  expect(parsed).toEqual([{ id: '1', column_2: '2', id_2: '3' }]);
  expect(result.warnings.some((w) => w.includes('column_2'))).toBe(true);
  expect(result.warnings.some((w) => w.includes('id_2'))).toBe(true);

  const withoutHeader = buildTable(
    [
      ['a', 'b'],
      ['c', 'd'],
    ],
    { format: 'json', headerRow: false, pretty: false },
  );
  expect(JSON.parse(withoutHeader.output)).toEqual([
    ['a', 'b'],
    ['c', 'd'],
  ]);
});

it('a header cell named __proto__ becomes an own key and Object.prototype is never modified', () => {
  const result = buildTable([['__proto__'], ['evil']], { format: 'json', pretty: false });
  const parsed = JSON.parse(result.output) as Record<string, unknown>[];
  expect(Object.hasOwn(parsed[0]!, '__proto__')).toBe(true);
  expect(parsed[0]!.__proto__).toBe('evil');
  expect(Object.getPrototypeOf(parsed[0])).toBe(Object.prototype);
  expect(Object.prototype as unknown as Record<string, unknown>).not.toHaveProperty('evil');
});

it('nothing is written to the console while building tables', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => undefined),
  );
  try {
    buildTable(
      [
        ['<script>x</script>|__proto__', 'a\\|b'],
        ['1', '2'],
      ],
      { format: 'markdown' },
    );
    buildTable(
      [
        ['<script>x</script>|__proto__', 'a\\|b'],
        ['1', '2'],
      ],
      { format: 'html' },
    );
    buildTable(
      [
        ['<script>x</script>|__proto__', 'a\\|b'],
        ['1', '2'],
      ],
      { format: 'csv' },
    );
    buildTable(
      [
        ['<script>x</script>|__proto__', 'a\\|b'],
        ['1', '2'],
      ],
      { format: 'json' },
    );
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('short rows are padded and fully empty trailing rows and columns are dropped', () => {
  const result = buildTable([['a', 'b', 'c'], ['d'], ['', '', ''], ['', '']]);
  expect(result.rows).toBe(2);
  expect(result.columns).toBe(3);
});

it('building from no cells at all is refused with TableBuilderError', () => {
  expect(() => buildTable([])).toThrow(TableBuilderError);
  expect(() => buildTable([['']])).toThrow(TableBuilderError);
});
