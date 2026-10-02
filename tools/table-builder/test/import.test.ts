import { test, expect, vi } from 'vitest';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { buildTable, importTable, formatTsv, TableBuilderError, TableImportError } from '../src/index';

// Expected cells below come from four places and never from this tool's own earlier output:
//
// 1. The GitHub Flavored Markdown specification 0.29-gfm, section 4.10 Tables (extension), fetched with
//    `curl -fsSL https://github.github.com/gfm/` on 2026-10-02. Examples 198 to 205 are quoted with the HTML the
//    specification prints for each; the cell text is read off that printed HTML.
// 2. RFC 4180 section 2 (CSV) and the IANA registration of text/tab-separated-values (TSV), fetched 2026-10-02.
// 3. The HTML Living Standard, 4.9 Tables (the `rows` order of a table and the span limits) and 13.2 (the parser).
// 4. micromark 4.0.2 with micromark-extension-gfm 3.0.0 (an independent GFM renderer, used as a second opinion)
//    and parse5 8.0.1 (an independent HTML parser, the one the tool itself reads HTML with).

/** Runs Markdown through micromark with the GFM table extension; a `<br>` typed into a cell is a line break, as in a real renderer. */
function renderGfm(markdown: string): string {
  return micromark(markdown, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
    allowDangerousHtml: true,
  });
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

// Every character a random cell may hold. A cell never starts or ends with a space (GFM trims the space between a
// pipe and a cell's content, so such a cell can never come back from Markdown) and never holds a semicolon, so a run
// of these characters cannot spell an HTML entity by chance.
const RANDOM_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 |\\*_`~[]()<>&#!.,:-+="\'';

function randomCell(rng: () => number): string {
  const length = Math.floor(rng() * 8);
  if (length === 0) return 'x';
  const chars: string[] = [];
  for (let i = 0; i < length; i++) chars.push(RANDOM_CHARS[Math.floor(rng() * RANDOM_CHARS.length)]!);
  if (length > 2 && rng() < 0.2) chars[Math.floor(length / 2)] = '\n';
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
  return grid;
}

const lines = (...rows: string[]): string => rows.join('\n');

test('a GFM pipe table imports with alignment, escaped pipes and br line breaks, padding short rows and trimming long ones', () => {
  // Example 198: the plain table.
  expect(importTable(lines('| foo | bar |', '| --- | --- |', '| baz | bim |'), 'markdown').rows).toEqual([
    ['foo', 'bar'],
    ['baz', 'bim'],
  ]);

  // Example 199: alignment colons, and no outer pipes on the delimiter or body rows. The printed HTML holds
  // abc, defghi, bar and baz (an alignment is not a cell).
  expect(importTable(lines('| abc | defghi |', ':-: | -----------:', 'bar | baz'), 'markdown').rows).toEqual([
    ['abc', 'defghi'],
    ['bar', 'baz'],
  ]);

  // Example 200: an escaped pipe is part of a cell, also inside a code span and a strong span (the specification
  // prints `f|oo`, `b <code>|</code> az` and `b <strong>|</strong> im`). The cell text keeps the Markdown that
  // surrounds the pipe, because the grid holds text, not rendered inlines.
  expect(
    importTable(lines('| f\\|oo  |', '| ------ |', '| b `\\|` az |', '| b **\\|** im |'), 'markdown').rows,
  ).toEqual([['f|oo'], ['b `|` az'], ['b **|** im']]);

  // Example 201: a line that starts a block quote ends the table (the specification prints the table and then a
  // block quote). Example 202: a line with no pipe is still a row of one cell, and a blank line ends the table.
  expect(importTable(lines('| abc | def |', '| --- | --- |', '| bar | baz |', '> bar'), 'markdown').rows).toEqual([
    ['abc', 'def'],
    ['bar', 'baz'],
  ]);
  expect(
    importTable(lines('| abc | def |', '| --- | --- |', '| bar | baz |', 'bar', '', 'bar'), 'markdown').rows,
  ).toEqual([
    ['abc', 'def'],
    ['bar', 'baz'],
    ['bar', ''],
  ]);

  // Example 204: "If there are a number of cells fewer than the number of cells in the header row, empty cells are
  // inserted. If there are greater, the excess is ignored." The page says what was dropped.
  const ragged = importTable(lines('| abc | def |', '| --- | --- |', '| bar |', '| bar | baz | boo |'), 'markdown');
  expect(ragged.rows).toEqual([
    ['abc', 'def'],
    ['bar', ''],
    ['bar', 'baz'],
  ]);
  expect(ragged.warnings.join('\n')).toMatch(/more cells than the header/);
  expect(ragged.warnings.join('\n')).toMatch(/boo/);

  // Example 205: no rows in the body gives a header only.
  expect(importTable(lines('| abc | def |', '| --- | --- |'), 'markdown').rows).toEqual([['abc', 'def']]);

  // Example 203: a delimiter row with a different number of cells is not a table; the specification prints a
  // paragraph, so there is nothing to import.
  expect(() => importTable(lines('| abc | def |', '| --- |', '| bar |'), 'markdown')).toThrow(TableImportError);

  // A line break typed as <br> in any of its spellings becomes a line break in the cell, and a table in the
  // middle of other text is found; a table inside a fenced code block is not one.
  expect(
    importTable(
      lines('Some text', '', '| a<br>b | c<BR/>d |', '|---|---|', '| e<br />f | g |', '', 'after'),
      'markdown',
    ).rows,
  ).toEqual([
    ['a\nb', 'c\nd'],
    ['e\nf', 'g'],
  ]);
  expect(() => importTable(lines('```', '| a | b |', '| - | - |', '```'), 'markdown')).toThrow(TableImportError);
});

test('an HTML table imports with th and td text, br line breaks and spans expanded with a warning, and nested tables are not read', () => {
  // HTML 4.9.1: caption is not a row; the `rows` of a table list thead rows first, then tbody rows in tree order,
  // then tfoot rows, wherever they were written. The parser (13.2.6.4.9) adds the tbody that the first two rows
  // lack and starts a second one after the tfoot. Text: a character reference is decoded, a br is a line break,
  // and white space written across source lines or tabs reads as one space, as a browser shows it; a run of plain
  // spaces on one line is kept as written.
  const html = lines(
    '<table>',
    '  <caption>ignored</caption>',
    '  <thead><tr><th>Name</th><th>Qty &amp; unit</th></tr></thead>',
    '  <tr><td>Widget<br>blue</td><td>  3\n     pcs   x </td></tr>',
    '  <tfoot><tr><td>Total</td><td>&lt;3&gt;</td></tr></tfoot>',
    '  <tr><td>Gadget</td><td>a&nbsp;b</td></tr>',
    '</table>',
  );
  const result = importTable(html, 'html');
  expect(result.rows).toEqual([
    ['Name', 'Qty & unit'],
    ['Widget\nblue', '3 pcs   x'],
    ['Gadget', 'a\u{a0}b'],
    ['Total', '<3>'],
  ]);
  expect(result.warnings.join('\n')).toMatch(/spaces, tabs and line breaks/);

  // A neatly indented table needs no whitespace warning, because only leading and trailing space was removed.
  const neat = importTable('<table>\n  <tr>\n    <td>\n      a\n    </td>\n    <td>b</td>\n  </tr>\n</table>', 'html');
  expect(neat.rows).toEqual([['a', 'b']]);
  expect(neat.warnings).toEqual([]);

  // colspan and rowspan (HTML 4.9.11, 4.9.12): a merged cell is repeated into every slot it covers, and the page
  // says so. A colspan of 0 or a missing one is 1; a rowspan of 0 reaches the end of its row group.
  const spans = importTable(
    lines(
      '<table>',
      '<tr><td colspan="2">wide</td><td>x</td></tr>',
      '<tr><td rowspan="2">tall</td><td>a</td><td>y</td></tr>',
      '<tr><td>b</td><td>z</td></tr>',
      '</table>',
    ),
    'html',
  );
  expect(spans.rows).toEqual([
    ['wide', 'wide', 'x'],
    ['tall', 'a', 'y'],
    ['tall', 'b', 'z'],
  ]);
  expect(spans.warnings.join('\n')).toMatch(/colspan or rowspan/);
  const toTheEnd = importTable('<table><tr><td rowspan="0">t</td><td>1</td></tr><tr><td>2</td></tr></table>', 'html');
  expect(toTheEnd.rows).toEqual([
    ['t', '1'],
    ['t', '2'],
  ]);

  // A table inside a cell is not read: its text is not part of the cell, the page says so, and only the first
  // table of the text is imported.
  const nested = importTable(
    '<p>intro</p><table><tr><td>outer<table><tr><td>inner</td></tr></table></td><td>b</td></tr></table><table><tr><td>second</td></tr></table>',
    'html',
  );
  expect(nested.rows).toEqual([['outer', 'b']]);
  expect(nested.warnings.join('\n')).toMatch(/nested/i);

  // No table at all is refused and names the format.
  expect(() => importTable('<p>no table here</p>', 'html')).toThrow(/HTML/);
});

test('pasted HTML with a script imports its table text and nothing runs', async () => {
  // parse5 builds a tree and never runs anything. The marker would be set by a script that ran; a fetch spy proves
  // no address the pasted markup names (image, link, stylesheet, script source) was requested.
  const marker = '__fodtTableImportRan';
  const fetchSpy = vi.fn(() => Promise.reject(new Error('no network is allowed here')));
  vi.stubGlobal('fetch', fetchSpy);
  try {
    const html = lines(
      `<script>globalThis.${marker} = true;</script>`,
      '<link rel="stylesheet" href="http://127.0.0.1:1/style.css">',
      '<table>',
      `<tr><td>a<script>globalThis.${marker} = true;</script></td>`,
      `<td onclick="globalThis.${marker} = true"><img src="http://127.0.0.1:1/x.png" onerror="globalThis.${marker} = true">`,
      `<a href="javascript:globalThis.${marker}=true">b</a><style>td { color: red }</style></td></tr>`,
      '</table>',
      '<script src="http://127.0.0.1:1/x.js"></script>',
    );
    const result = importTable(html, 'html');
    expect(result.rows).toEqual([['a', 'b']]);
    expect(result.warnings.join('\n')).toMatch(/script and style/i);
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    // Only strings come back: no tree node, element or markup leaves the importer.
    for (const row of result.rows) for (const cell of row) expect(typeof cell).toBe('string');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});

test('CSV and TSV import follow RFC 4180 and the IANA registration with the chosen delimiter', () => {
  // RFC 4180 section 2, rules 1 and 2: records end with CRLF, and the last one needs no ending.
  expect(importTable('aaa,bbb,ccc\r\nzzz,yyy,xxx\r\n', 'csv').rows).toEqual([
    ['aaa', 'bbb', 'ccc'],
    ['zzz', 'yyy', 'xxx'],
  ]);
  expect(importTable('aaa,bbb,ccc\r\nzzz,yyy,xxx', 'csv').rows).toEqual([
    ['aaa', 'bbb', 'ccc'],
    ['zzz', 'yyy', 'xxx'],
  ]);
  // Rules 5 to 7: a quoted field may hold a line break, a comma and a doubled quote.
  expect(importTable('"aaa","b\r\nbb","ccc"\r\nzzz,yyy,xxx', 'csv').rows).toEqual([
    ['aaa', 'b\r\nbb', 'ccc'],
    ['zzz', 'yyy', 'xxx'],
  ]);
  expect(importTable('"aaa","b""bb","c,cc"', 'csv').rows).toEqual([['aaa', 'b"bb', 'c,cc']]);

  // The chosen delimiter splits fields; the others are plain text.
  expect(importTable('a;b,c;d', 'csv', { delimiter: ';' }).rows).toEqual([['a', 'b,c', 'd']]);
  expect(importTable('a|b\n"c|d"|e', 'csv', { delimiter: '|' }).rows).toEqual([
    ['a', 'b'],
    ['c|d', 'e'],
  ]);
  expect(importTable('a\tb\n"c\td"\te', 'csv', { delimiter: '\t' }).rows).toEqual([
    ['a', 'b'],
    ['c\td', 'e'],
  ]);

  // A quote that is never closed is refused with its line and column.
  expect(() => importTable('a,b\n"c,d', 'csv')).toThrow(/line 2, column 1/);

  // IANA text/tab-separated-values: one record per line, fields separated by a tab, and no quoting, so a quote
  // is an ordinary character. The registration does not name the line ending, so CRLF, LF and CR are accepted.
  expect(importTable('a\tb\r\n1\t2\n3\t4\r5\t6\n', 'tsv').rows).toEqual([
    ['a', 'b'],
    ['1', '2'],
    ['3', '4'],
    ['5', '6'],
  ]);
  expect(importTable('"a"\t"b\n,\t;', 'tsv').rows).toEqual([
    ['"a"', '"b'],
    [',', ';'],
  ]);
  // Empty fields at either end are fields.
  expect(importTable('\tx\t\n', 'tsv').rows).toEqual([['', 'x', '']]);
});

test('TSV export refuses a cell containing a tab or line break naming its cell', () => {
  // The IANA registration says fields that contain tabs are not allowed, and TSV has no quoting for a line break.
  expect(
    formatTsv([
      ['a', 'b'],
      ['c d', ''],
    ]),
  ).toBe('a\tb\nc d\t');
  expect(
    buildTable(
      [
        ['a', 'b'],
        ['1', '2'],
      ],
      { format: 'tsv' },
    ).output,
  ).toBe('a\tb\n1\t2');
  expect(() =>
    buildTable(
      [
        ['a', 'b'],
        ['1', 'x\ty'],
      ],
      { format: 'tsv' },
    ),
  ).toThrow(/row 2, column 2.*tab/);
  expect(() => buildTable([['a\nb', 'b']], { format: 'tsv' })).toThrow(/row 1, column 1.*line break/);
  expect(() =>
    buildTable(
      [
        ['a', 'b'],
        ['1', '2'],
        ['x', 'y\rz'],
      ],
      { format: 'tsv' },
    ),
  ).toThrow(/row 3, column 2.*line break/);
  expect(() => formatTsv([['a\tb']])).toThrow(TableBuilderError);
  // A cell's own space is kept exactly, because TSV has no trimming.
  expect(buildTable([[' a ', 'b ']], { format: 'tsv' }).output).toBe(' a \tb ');
});

test('every exported Markdown table rendered by micromark with GFM imports back to the same cells', () => {
  const rng = mulberry32(0x13_12_01);
  for (let i = 0; i < 200; i++) {
    const grid = randomGrid(rng);
    const alignments = grid[0]!.map(() => ['left', 'center', 'right', 'none'][Math.floor(rng() * 4)]!).join(',');
    const markdown = buildTable(grid, { format: 'markdown', headerRow: true, alignments, pad: rng() < 0.5 }).output;

    // Direction one: micromark renders the Markdown to HTML (it knows nothing of this tool), and the HTML importer
    // reads the cells back from that rendering.
    const rendered = renderGfm(markdown);
    expect(importTable(rendered, 'html').rows, `rendered:\n${rendered}\nmarkdown:\n${markdown}`).toEqual(grid);

    // Direction two: the Markdown importer reads the same Markdown directly.
    expect(importTable(markdown, 'markdown').rows, `markdown:\n${markdown}`).toEqual(grid);
  }

  // The HTML this folder writes is read back to the same cells too.
  const grid = [
    ['Name', 'Note'],
    ['a<b', 'say "hi" & go'],
    ['two\nlines', '|pipe|'],
  ];
  const html = buildTable(grid, { format: 'html', pretty: true }).output;
  expect(importTable(html, 'html').rows).toEqual(grid);

  // Every specification example reads the same through micromark and through the Markdown importer, whatever the
  // renderer decides is a table (an example the specification prints as a paragraph is refused by both).
  const examples = [
    lines('| foo | bar |', '| --- | --- |', '| baz | bim |'),
    lines('| abc | defghi |', ':-: | -----------:', 'bar | baz'),
    lines('| abc | def |', '| --- | --- |', '| bar | baz |', '> bar'),
    lines('| abc | def |', '| --- | --- |', '| bar | baz |', 'bar', '', 'bar'),
    lines('| abc | def |', '| --- | --- |', '| bar |', '| bar | baz | boo |'),
    lines('| abc | def |', '| --- | --- |'),
  ];
  for (const example of examples) {
    expect(importTable(example, 'markdown').rows, example).toEqual(importTable(renderGfm(example), 'html').rows);
  }
  expect(renderGfm(lines('| abc | def |', '| --- |', '| bar |'))).not.toContain('<table>');
});

test('more than 10000 cells are refused', () => {
  // Exactly the limit is fine; one more is refused naming the limit, in every format.
  const rowOf = (n: number): string => Array.from({ length: n }, (_, i) => String(i)).join(',');
  const exactly = Array.from({ length: 100 }, () => rowOf(100)).join('\n');
  expect(importTable(exactly, 'csv').rows.flat()).toHaveLength(10_000);
  const over = `${exactly}\nx`;
  expect(() => importTable(over, 'csv')).toThrow(/10,000/);
  expect(() => importTable(over.replace(/,/g, '\t'), 'tsv')).toThrow(/10,000/);

  const mdRow = (n: number): string => `| ${Array.from({ length: n }, (_, i) => String(i)).join(' | ')} |`;
  const mdHeader = `| ${Array.from({ length: 100 }, () => '-').join(' | ')} |`;
  const markdown = [mdRow(100), mdHeader, ...Array.from({ length: 99 }, () => mdRow(100))].join('\n');
  expect(importTable(markdown, 'markdown').rows.flat()).toHaveLength(10_000);
  expect(() => importTable(`${markdown}\n| x |`, 'markdown')).toThrow(/10,000/);

  // A merged cell counts for every slot it covers, so a few small tags cannot make a huge table. A rowspan counts
  // only the rows its group really has (HTML 4.9.12 clips it there), so the group is written out in full.
  const tall = (rowspan: number, rows: number): string =>
    `<table><tr><td colspan="1000" rowspan="${rowspan}">x</td></tr>${'<tr></tr>'.repeat(rows - 1)}</table>`;
  expect(importTable(tall(10, 10), 'html').rows.flat()).toHaveLength(10_000);
  expect(() => importTable(tall(11, 11), 'html')).toThrow(/10,000/);
  expect(importTable(tall(11, 3), 'html').rows.flat()).toHaveLength(3000);
  expect(() => importTable(`<table>${'<tr><td>a</td></tr>'.repeat(10_001)}</table>`, 'html')).toThrow(/10,000/);
}, 60_000);

test('an empty import gives no rows, a single cell and a header only import fine, and a page without a table is refused naming its format', () => {
  for (const from of ['html', 'csv', 'tsv', 'markdown'] as const) {
    expect(importTable('', from)).toEqual({ rows: [], warnings: [] });
    expect(importTable('  \n \t\n', from).rows).toEqual([]);
  }
  expect(importTable('only', 'csv').rows).toEqual([['only']]);
  expect(importTable('only', 'tsv').rows).toEqual([['only']]);
  expect(importTable('<table><tr><td>only</td></tr></table>', 'html').rows).toEqual([['only']]);
  expect(importTable(lines('| only |', '| - |'), 'markdown').rows).toEqual([['only']]);
  expect(importTable('<table><tr><th>h1</th><th>h2</th></tr></table>', 'html').rows).toEqual([['h1', 'h2']]);
  expect(() => importTable('just a paragraph', 'markdown')).toThrow(/Markdown/);
});
