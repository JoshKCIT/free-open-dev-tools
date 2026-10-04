import { it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import {
  ChartError,
  MAX_PASTE_BYTES,
  MAX_POINTS,
  MAX_SERIES,
  MAX_SLICES,
  PALETTES,
  altText,
  chartSvg,
  describeChart,
  makeChart,
  meta as toolMeta,
  parseTable,
  readRows,
  shortLabel,
  tableRows,
  visible,
  type MakeChartOptions,
  type ParsedTable,
} from '../src/index';
import { CSV_CASES } from './fixtures/csv-cases';

const BACKSLASH = String.fromCharCode(92);
const BAR: MakeChartOptions = { type: 'bar' };
const FRUIT = 'Fruit,Count\nApples,3\nPears,5\nCherries,8\n';

const spies: MockInstance[] = [];
beforeEach(() => {
  for (const name of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    spies.push(vi.spyOn(console, name).mockImplementation(() => undefined));
  }
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/** The message of the ChartError a call throws; fails the test when it throws anything else or nothing. */
function refusal(call: () => unknown): string {
  try {
    call();
  } catch (err) {
    expect(err).toBeInstanceOf(ChartError);
    return (err as ChartError).message;
  }
  throw new Error('the call was expected to be refused');
}

function must(text: string, options: MakeChartOptions) {
  const chart = makeChart(text, options);
  if (chart === null) throw new Error('a chart was expected');
  return chart;
}

/** The text of the plain rows `Label n` with the given values, for one series called Value. */
function rowsOf(values: number[]): string {
  return values.map((v, i) => `L${i + 1},${v}`).join('\n');
}

it('comma and tab separated rows with quotes are read exactly and a trailing empty field is kept', () => {
  const comma = parseTable('Fruit,Count\nApples,3\nPears,5', { header: true });
  expect(comma.headers).toEqual(['Fruit', 'Count']);
  expect(comma.labels).toEqual(['Apples', 'Pears']);
  expect(comma.series).toEqual([{ name: 'Count', values: [3, 5] }]);
  expect(comma.notes).toEqual([]);

  // The same rows with tabs read the same.
  expect(parseTable('Fruit\tCount\nApples\t3\nPears\t5', { header: true })).toEqual(comma);

  // A label in quotes keeps its comma, its doubled quote and its line break.
  const quoted = parseTable('Label,Value\n"Big, ""fat"" apple",4\n"two\nlines",6', { header: true });
  expect(quoted.labels).toEqual(['Big, "fat" apple', 'two\nlines']);
  expect(quoted.series[0]!.values).toEqual([4, 6]);

  // A row that ends in a separator keeps its empty last cell, for commas and for tabs.
  expect(readRows('Fruit,Count,\nApples,3,\n').rows).toEqual([
    ['Fruit', 'Count', ''],
    ['Apples', '3', ''],
  ]);
  expect(readRows('a\tb\t').rows).toEqual([['a', 'b', '']]);
  expect(readRows('a,b,').rows).toEqual([['a', 'b', '']]);

  // A column that is empty in every row is left out, with a note, never silently.
  const trailing = parseTable('Fruit,Count,\nApples,3,\nPears,5,', { header: true });
  expect(trailing.series.map((s) => s.name)).toEqual(['Count']);
  expect(trailing.notes).toEqual(['Column 3 is empty and was left out.']);

  // An empty cell in a column that has numbers is refused, never read as zero.
  expect(refusal(() => parseTable('Fruit,A,B\nApples,3,\nPears,5,6', { header: true }))).toMatch(/Row 2, column 3/);

  // The delimiter is a tab only when the first line holds a tab outside quotes.
  expect(readRows('"a\tb",1\nc,2').delimiter).toBe(',');
  expect(readRows('a\tb\n1,2').delimiter).toBe('\t');

  // Blank lines, a byte order mark and every kind of line end are tolerated.
  const messy = parseTable(String.fromCodePoint(0xfeff) + 'Fruit,Count\r\n\r\nApples,3\rPears,5\n\n', { header: true });
  expect(messy.headers).toEqual(['Fruit', 'Count']);
  expect(messy.labels).toEqual(['Apples', 'Pears']);

  // Without a header the columns get plain names, with one number column called Value.
  const bare = parseTable('Apples,3\nPears,5', { header: false });
  expect(bare.headers).toEqual(['Label', 'Value']);
  expect(bare.labels).toEqual(['Apples', 'Pears']);
  const wide = parseTable('Apples,3,4\nPears,5,6', { header: false });
  expect(wide.series.map((s) => s.name)).toEqual(['Series 1', 'Series 2']);

  // A quote in the middle of an unquoted value is kept; a quote that opens a value must be closed before the separator.
  expect(readRows('a,b"c,d').rows).toEqual([['a', 'b"c', 'd']]);
  expect(refusal(() => readRows('a,"b"c,d'))).toMatch(/Row 1, column 2/);
  expect(refusal(() => readRows('a\n"never closed,1'))).toMatch(/Row 2/);
});

it('rows are read the same as the csv module of Python reads them', () => {
  expect(CSV_CASES.length).toBeGreaterThanOrEqual(17);
  for (const c of CSV_CASES) {
    const read = readRows(c.text);
    expect({ name: c.name, delimiter: read.delimiter, rows: read.rows }).toEqual({
      name: c.name,
      delimiter: c.delimiter,
      rows: c.rows,
    });
  }
});

it('numbers are read strictly and anything else is refused naming its row and column', () => {
  const good: [string, number][] = [
    ['5', 5],
    ['-5', -5],
    ['+5', 5],
    ['0.5', 0.5],
    ['12.25', 12.25],
    ['1e3', 1000],
    ['1E3', 1000],
    ['1.5e-3', 0.0015],
    ['2e+2', 200],
    [' 7 ', 7],
    ['-0', 0],
    ['007', 7],
  ];
  for (const [cell, expected] of good) {
    const table = parseTable('A,' + cell, { header: false });
    // Object.is tells -0 from 0: a negative zero must read as plain zero.
    expect(Object.is(table.series[0]!.values[0], expected)).toBe(true);
  }

  const fullWidth = String.fromCodePoint(0xff11, 0xff12);
  const bad = [
    '1,000',
    '3,5',
    '1e999',
    '-1e999',
    '1e101',
    '-1e101',
    '.5',
    '5.',
    '0x10',
    'NaN',
    'Infinity',
    '--5',
    '1e',
    'abc',
    '5%',
    '$5',
    '1_000',
    fullWidth,
    ' ',
  ];
  for (const cell of bad) {
    // The value is in quotes so that a comma in it stays inside the cell.
    expect(refusal(() => parseTable('A,"' + cell + '"', { header: false }))).toMatch(/^Row 1, column 2/);
    expect(refusal(() => parseTable('L,V\nA,"' + cell + '"', { header: true }))).toMatch(/^Row 2, column 2/);
  }
  // An empty cell in a column that has a header is refused; with no header, a column that is empty in every row is not a
  // number column at all, so it is left out with a note and there is nothing to draw yet.
  expect(refusal(() => parseTable('L,V\nA,""', { header: true }))).toMatch(/^Row 2, column 2: this value is empty/);
  expect(parseTable('A,""', { header: false })).toEqual({
    headers: [],
    labels: [],
    series: [],
    notes: ['Column 2 is empty and was left out.'],
  });
  // A decimal comma in a tab separated paste is refused the same way.
  expect(refusal(() => parseTable('A\t3,5', { header: false }))).toMatch(/^Row 1, column 2/);

  // The row and the column are counted in the pasted text, the header row being row 1 and the first column column 1.
  expect(refusal(() => parseTable('L,V,W\nA,1,2\nB,3,x', { header: true }))).toMatch(/^Row 3, column 3/);
  expect(refusal(() => parseTable('A,1\nB,2\nC,y', { header: false }))).toMatch(/^Row 3, column 2/);
  // A row with fewer cells than the widest row has empty cells, which are refused.
  expect(refusal(() => parseTable('A,1,2\nB,3', { header: false }))).toMatch(/^Row 2, column 3/);
});

it('the paste, point, series and slice limits and invalid pie values are refused with plain messages', () => {
  expect([MAX_PASTE_BYTES, MAX_POINTS, MAX_SERIES, MAX_SLICES]).toEqual([65_536, 200, 8, 24]);

  // 64 KiB exactly is read; one byte more is refused before any reading, and the size is in bytes, not characters.
  const exact = 'x'.repeat(MAX_PASTE_BYTES - 2) + ',1';
  expect(makeChart(exact, { ...BAR, header: false })).not.toBeNull();
  expect(refusal(() => makeChart(exact + '0', { ...BAR, header: false }))).toMatch(/65,536 bytes/);
  const accents = 'é'.repeat(32_767) + ',1';
  expect(makeChart(accents, { ...BAR, header: false })).not.toBeNull();
  expect(refusal(() => makeChart('é'.repeat(32_768) + ',1', { ...BAR, header: false }))).toMatch(/65,536 bytes/);

  // 200 points are drawn, 201 are refused, with and without a header row.
  const two = (n: number) => rowsOf(Array.from({ length: n }, (_, i) => i + 1));
  expect(makeChart(two(200), { ...BAR, header: false })).not.toBeNull();
  expect(makeChart('L,V\n' + two(200), BAR)).not.toBeNull();
  expect(refusal(() => makeChart(two(201), { ...BAR, header: false }))).toMatch(/200 points/);
  expect(refusal(() => makeChart('L,V\n' + two(201), { ...BAR, type: 'line' }))).toMatch(/200 points/);

  // 8 series are drawn, 9 are refused.
  const series = (n: number) =>
    'L,' +
    Array.from({ length: n }, (_, i) => 's' + i).join(',') +
    '\nA,' +
    Array.from({ length: n }, (_, i) => i + 1).join(',');
  expect(makeChart(series(8), BAR)).not.toBeNull();
  expect(refusal(() => makeChart(series(9), BAR))).toMatch(/8 series/);

  // A pie takes 24 slices and refuses 25; a bar chart takes 25.
  expect(makeChart(rowsOf(Array.from({ length: 24 }, () => 1)), { type: 'pie', header: false })).not.toBeNull();
  expect(refusal(() => makeChart(rowsOf(Array.from({ length: 25 }, () => 1)), { type: 'pie', header: false }))).toMatch(
    /24 slices/,
  );
  expect(makeChart(rowsOf(Array.from({ length: 25 }, () => 1)), { type: 'bar', header: false })).not.toBeNull();

  // A pie refuses a negative value and a total of zero, but a bar or line chart takes a negative value.
  expect(refusal(() => makeChart('A,-1\nB,5', { type: 'pie', header: false }))).toMatch(/negative/);
  expect(refusal(() => makeChart('A,0\nB,0', { type: 'pie', header: false }))).toMatch(/zero/);
  expect(makeChart('A,0\nB,5', { type: 'pie', header: false })).not.toBeNull();
  expect(makeChart('A,-1\nB,5', { type: 'bar', header: false })).not.toBeNull();
  expect(makeChart('A,-1\nB,5', { type: 'line', header: false })).not.toBeNull();

  // The writer refuses the same things when it is handed a table directly.
  const table = (values: number[]): ParsedTable => ({
    headers: ['Label', 'Value'],
    labels: values.map((_, i) => 'L' + i),
    series: [{ name: 'Value', values }],
    notes: [],
  });
  const opts = { title: '', xLabel: '', yLabel: '', legend: true, values: false, palette: 'default' };
  expect(() => chartSvg(table([1, -1]), { ...opts, type: 'pie' })).toThrow(ChartError);
  expect(() => chartSvg(table([0, 0]), { ...opts, type: 'pie' })).toThrow(ChartError);
  expect(() => chartSvg(table(Array.from({ length: 25 }, () => 1)), { ...opts, type: 'pie' })).toThrow(ChartError);
  expect(() => chartSvg(table([]), { ...opts, type: 'bar' })).toThrow(ChartError);
  // A number above 1e100 in size cannot be drawn (the axis would overflow), here and in the reader.
  expect(() => chartSvg(table([1e101]), { ...opts, type: 'bar' })).toThrow(ChartError);
  expect(() => chartSvg(table([-1e101, 1]), { ...opts, type: 'line' })).toThrow(ChartError);
  expect(makeChart('A,1e100\nB,-1e100', { ...BAR, header: false })).not.toBeNull();

  // A chart type that is not one of the three is refused with a plain sentence.
  expect(refusal(() => makeChart('A,1', { type: 'donut' as never, header: false }))).toMatch(/bar, line or pie/);

  // Every message is a plain sentence: no stack, no class name, no raw error text.
  for (const message of [
    refusal(() => makeChart(exact + '0', { ...BAR, header: false })),
    refusal(() => makeChart(series(9), BAR)),
    refusal(() => makeChart('A,-1\nB,5', { type: 'pie', header: false })),
  ]) {
    expect(message).toMatch(/^[A-Z][^\n]*[.]$/);
    expect(message).not.toMatch(/Error|undefined|NaN|\bat \w+ \(/);
  }
});

it('an empty paste gives no chart and a single row gives one bar, one point and a full-circle pie', () => {
  for (const text of ['', '   ', '\n\n', ' \r\n \t\n']) {
    expect(makeChart(text, BAR)).toBeNull();
    expect(makeChart(text, { type: 'pie' })).toBeNull();
  }
  // A paste that holds only a header row has no data to draw yet, which is also no chart and no error.
  expect(makeChart('Fruit,Count', BAR)).toBeNull();

  const bar = must('Apples,3', { type: 'bar', header: false }).svg;
  expect(bar.match(/<rect\b[^>]*role="graphics-symbol"/g)).toHaveLength(1);
  const line = must('Apples,3', { type: 'line', header: false }).svg;
  expect(line.match(/<circle\b[^>]*role="graphics-symbol"/g)).toHaveLength(1);
  expect(line).not.toMatch(/<polyline/);
  const pie = must('Apples,3', { type: 'pie', header: false }).svg;
  expect(pie.match(/role="graphics-symbol"/g)).toHaveLength(1);
  const circle = /<circle\b[^>]*role="graphics-symbol"[^>]*>/.exec(pie);
  expect(circle).not.toBeNull();
  expect(circle![0]).toMatch(/aria-label="Apples: 3"/);
  // The whole circle is one shape, so no slice needs an arc that starts and ends at the same point.
  expect(pie).not.toMatch(/<path/);

  // A single row still has an alt text, a description and a table.
  const one = must('Apples,3', { type: 'bar', header: false });
  expect(one.alt).toBe('Bar chart with 1 point. Largest value 3 (Apples). Smallest value 3 (Apples).');
  expect(one.table.rows).toEqual([['Apples', '3']]);
});

it('labels are cut at 40 code points with an ellipsis and control and bidirectional characters are shown escaped', () => {
  const forty = 'x'.repeat(40);
  expect(shortLabel(forty)).toBe(forty);
  expect(shortLabel(forty + 'y')).toBe(forty + '…');
  // An astral character counts once: 40 of them are kept whole, 41 are cut to 40.
  const smile = String.fromCodePoint(0x1f600);
  expect(shortLabel(smile.repeat(40))).toBe(smile.repeat(40));
  expect(shortLabel(smile.repeat(41))).toBe(smile.repeat(40) + '…');
  expect(shortLabel('x'.repeat(39) + smile + 'y')).toBe('x'.repeat(39) + smile + '…');
  expect(shortLabel('')).toBe('(no label)');

  // The cut label is what the table, the alt text and the description show.
  const long = 'L'.repeat(41);
  const chart = must(`Label,Value\n${long},4\nshort,9`, BAR);
  expect(chart.table.rows[0]![0]).toBe('L'.repeat(40) + '…');
  expect(chart.alt).toContain('Smallest value 4 (' + 'L'.repeat(40) + '…)');
  expect(chart.description.join(' ')).toContain('4 (' + 'L'.repeat(40) + '…)');
  expect(chart.table.headers).toEqual(['Label', 'Value']);

  // Control and direction characters are written out, never passed through.
  const rlo = String.fromCodePoint(0x202e);
  const bel = String.fromCharCode(7);
  const tab = String.fromCharCode(9);
  const evil = `evil${rlo}gnp.exe`;
  expect(visible(evil)).toBe(`evil${BACKSLASH}u{202E}gnp.exe`);
  expect(visible(`a${bel}b`)).toBe(`a${BACKSLASH}u{7}b`);
  expect(visible(`a${tab}b`)).toBe(`a${BACKSLASH}u{9}b`);
  expect(visible(String.fromCharCode(0x85, 0x7f, 0x61c, 0x200e, 0x200f, 0x2066, 0x2069))).toBe(
    ['85', '7F', '61C', '200E', '200F', '2066', '2069'].map((h) => `${BACKSLASH}u{${h}}`).join(''),
  );
  expect(visible('plain text é 😀')).toBe('plain text é 😀');

  const hostile = must(`Label,Value\n"${evil}",4\n"a${bel}b",9`, { ...BAR, title: `T${rlo}itle` });
  expect(hostile.table.rows[0]![0]).toBe(`evil${BACKSLASH}u{202E}gnp.exe`);
  expect(hostile.table.rows[1]![0]).toBe(`a${BACKSLASH}u{7}b`);
  expect(hostile.alt).toContain(`T${BACKSLASH}u{202E}itle`);
  expect(hostile.alt).toContain(`evil${BACKSLASH}u{202E}gnp.exe`);
  for (const shown of [hostile.alt, hostile.description.join(' '), JSON.stringify(hostile.table)]) {
    expect(shown).not.toContain(rlo);
    expect(shown).not.toContain(bel);
  }
  // In the SVG the same characters are XML-escaped, so the file stays well formed.
  expect(hostile.svg).not.toContain(rlo);
  expect(hostile.svg).not.toContain(bel);
  expect(hostile.svg).toContain('&#x202E;');

  // The table shows each number exactly as it was read, not rounded to six digits.
  const digits = must('A,1234567\nB,0.1234567\nC,-0.5', { ...BAR, header: false });
  expect(digits.table.rows).toEqual([
    ['A', '1234567'],
    ['B', '0.1234567'],
    ['C', '-0.5'],
  ]);
  expect(tableRows({ headers: ['L', 'V'], labels: ['x'], series: [{ name: 'V', values: [2] }], notes: [] })).toEqual({
    headers: ['L', 'V'],
    rows: [['x', '2']],
  });
});

it('palette names are looked up safely for __proto__, constructor and toString', () => {
  expect([...PALETTES.keys()].sort()).toEqual(['colour-blind', 'default', 'grayscale', 'high-contrast']);
  const base = must(FRUIT, { ...BAR, palette: 'default' }).svg;
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '', 'no such palette']) {
    expect(PALETTES.get(name)).toBeUndefined();
    expect(must(FRUIT, { ...BAR, palette: name }).svg).toBe(base);
  }
  expect(must(FRUIT, { ...BAR, palette: 'high-contrast' }).svg).not.toBe(base);
});

it('nothing is written to the console while making charts', () => {
  const hostile = '"<script>x</script>",1\n"a ""b"" c",2\n';
  for (const type of ['bar', 'line', 'pie'] as const) {
    must(FRUIT, { type, title: 'T', xLabel: 'x', yLabel: 'y', legend: true, values: true });
    must(hostile, { type, header: false });
    refusal(() => makeChart('A,not a number', { type, header: false }));
    refusal(() => makeChart('x'.repeat(MAX_PASTE_BYTES + 1), { type }));
  }
  makeChart('', BAR);
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it('a refusal never repeats the pasted text', () => {
  const marker = 'FODT-CHART-MARKER';
  const messages = [
    refusal(() => makeChart(`A,${marker}`, { ...BAR, header: false })),
    refusal(() => makeChart(`A,"${marker}"x`, { ...BAR, header: false })),
    refusal(() => makeChart(`A,1\nB,"${marker}`, { ...BAR, header: false })),
    refusal(() => makeChart(`${marker},-1\nB,5`, { type: 'pie', header: false })),
  ];
  for (const message of messages) expect(message).not.toContain(marker);
  // Labels, series names and titles are shown in the chart, never in a message or a note.
  const chart = must(`L,${marker}\n${marker}-row,1,\n`, { ...BAR, title: marker.repeat(5) });
  expect(chart.notes.length).toBe(2);
  for (const note of chart.notes) expect(note).not.toContain(marker);
});

it('the alt text names the title, the type, the number of points and the largest and smallest values', () => {
  const table = parseTable(FRUIT, { header: true });
  expect(altText(table, 'bar', 'Fruit sold')).toBe(
    'Fruit sold. Bar chart with 3 points. Largest value 8 (Cherries). Smallest value 3 (Apples).',
  );
  expect(altText(table, 'line', '')).toBe(
    'Line chart with 3 points. Largest value 8 (Cherries). Smallest value 3 (Apples).',
  );
  expect(altText(table, 'pie', 'Shares')).toBe(
    'Shares. Pie chart with 3 slices. Largest value 8 (Cherries). Smallest value 3 (Apples).',
  );
  const two = parseTable('Month,Signups,Visits\nJan,2,10\nFeb,4,12\nMar,3,11\nApr,1,9', { header: true });
  expect(altText(two, 'line', 'Growth')).toBe(
    'Growth. Line chart with 4 points in 2 series. Largest value 12 (Feb, Visits). Smallest value 1 (Apr, Signups).',
  );
  // A pie reads only its first number column.
  expect(altText(two, 'pie', '')).toBe('Pie chart with 4 slices. Largest value 4 (Feb). Smallest value 1 (Apr).');
  // The first of equal values wins, in row order.
  expect(altText(parseTable('A,5\nB,5', { header: false }), 'bar', '')).toBe(
    'Bar chart with 2 points. Largest value 5 (A). Smallest value 5 (A).',
  );
  // The chart page gives the same sentence for the first example.
  expect(must(FRUIT, { ...BAR, title: 'Fruit sold' }).alt).toBe(altText(table, 'bar', 'Fruit sold'));
});

it('each series gets one sentence in the description and a pie describes its shares', () => {
  const table = parseTable(FRUIT, { header: true });
  expect(describeChart(table, 'bar')).toEqual(['Count: 3 values, from 3 (Apples) to 8 (Cherries), averaging 5.33333.']);
  expect(describeChart(table, 'bar', { xLabel: 'Fruit', yLabel: 'Number sold' })).toEqual([
    'Horizontal axis: Fruit.',
    'Vertical axis: Number sold.',
    'Count: 3 values, from 3 (Apples) to 8 (Cherries), averaging 5.33333.',
  ]);
  const two = parseTable('Month,Signups,Visits\nJan,2,10\nFeb,4,12', { header: true });
  expect(describeChart(two, 'line')).toEqual([
    'Signups: 2 values, from 2 (Jan) to 4 (Feb), averaging 3.',
    'Visits: 2 values, from 10 (Jan) to 12 (Feb), averaging 11.',
  ]);
  expect(describeChart(parseTable('A,4\nB,4', { header: false }), 'bar')).toEqual(['Value: 2 values, all equal to 4.']);
  expect(describeChart(parseTable('A,4', { header: false }), 'line')).toEqual(['Value: 1 value, 4 (A).']);
  // A pie: the share of each is worked out from the total (16 here, so 3 is 18.75 per cent and 8 is 50).
  expect(describeChart(table, 'pie')).toEqual([
    'Count: 3 slices adding up to 16. The largest is Cherries at 8 (50%), the smallest is Apples at 3 (18.75%).',
  ]);
  expect(describeChart(parseTable('A,4', { header: false }), 'pie')).toEqual(['Value: 1 slice, A at 4 (100%).']);
});

it('a pie of several number columns draws the first and says so', () => {
  const chart = must('Share,A,B\nx,1,5\ny,3,6', { type: 'pie' });
  expect(chart.notes).toEqual([
    'A pie chart shows the first number column only, so the other columns were left out of the picture.',
  ]);
  expect(chart.svg.match(/role="graphics-symbol"/g)).toHaveLength(2);
  // The table still shows the data that was pasted.
  expect(chart.table.headers).toEqual(['Share', 'A', 'B']);
  // A title or an axis label that is too long is cut, and a note says so without repeating it.
  const cut = must(FRUIT, { ...BAR, title: 'T'.repeat(61), xLabel: 'X'.repeat(41), yLabel: 'Y'.repeat(40) });
  expect(cut.notes).toEqual([
    'The title was shortened to 60 characters.',
    'The horizontal axis label was shortened to 40 characters.',
  ]);
});

it('a paste of 200 rows and 8 series is read and drawn within the time limit', () => {
  const head = 'Label,' + Array.from({ length: 8 }, (_, i) => 'Series ' + i).join(',');
  const rows = Array.from(
    { length: 200 },
    (_, r) => `Row number ${r},` + Array.from({ length: 8 }, (_, c) => (r * 7 + c * 13) % 97).join(','),
  );
  const text = head + '\n' + rows.join('\n');
  expect(text.length).toBeLessThan(MAX_PASTE_BYTES);
  const started = performance.now();
  const chart = makeChart(text, { type: 'line', legend: true, values: true });
  const elapsed = performance.now() - started;
  expect(chart).not.toBeNull();
  expect(chart!.svg.match(/role="graphics-symbol"/g)).toHaveLength(1600);
  expect(elapsed).toBeLessThan(5000);

  // A 64 KiB paste of one huge quoted value and one of a million separators are read in one pass too.
  const quoted = '"' + '""'.repeat(32_000) + '",1';
  const t0 = performance.now();
  const q = parseTable(quoted, { header: false });
  const t1 = performance.now();
  expect(q.labels[0]).toBe('"'.repeat(32_000));
  expect(t1 - t0).toBeLessThan(2000);
  const commas = ','.repeat(MAX_PASTE_BYTES - 1);
  const t2 = performance.now();
  const r = readRows(commas).rows;
  const t3 = performance.now();
  expect(r[0]).toHaveLength(MAX_PASTE_BYTES);
  expect(t3 - t2).toBeLessThan(2000);
}, 60_000);

it('the documentation states the limits the code enforces', () => {
  const limits = toolMeta.limits.join('\n');
  expect(limits).toContain(`${MAX_POINTS} points per series`);
  expect(limits).toContain(`${MAX_SERIES} series`);
  expect(limits).toContain(`${MAX_SLICES} slices`);
  expect(limits).toContain('64 KiB');
  expect(limits).toContain('40 characters');
  expect(toolMeta.standards.map((s) => s.url)).toEqual([
    'https://www.w3.org/TR/graphics-aria-1.0/',
    'https://www.w3.org/TR/SVG2/',
    'https://www.rfc-editor.org/rfc/rfc4180',
  ]);
});

it('a paste that starts with blank or white-space-only lines is read with the delimiter of its first real line', () => {
  const tabbed = '\nMonth\tSales\nJan\t5\nFeb\t7';
  expect(readRows(tabbed).delimiter).toBe('\t');
  const chart = must(tabbed, BAR);
  expect(chart.table.headers).toEqual(['Month', 'Sales']);
  expect(chart.table.rows).toEqual([
    ['Jan', '5'],
    ['Feb', '7'],
  ]);
  // Several blank lines, a line of only spaces and a carriage-return line end all count as blank.
  expect(readRows('\r\n  \n\n\t\nMonth\tSales\nJan\t5').delimiter).toBe('\t');
  expect(readRows(String.fromCodePoint(0xfeff) + '\n\nMonth\tSales\nJan\t5').delimiter).toBe('\t');
  // A tab at the start of the first real line is still a tab on that line.
  expect(readRows('\n\tSales\nJan\t5').delimiter).toBe('\t');
  // A first real line with only commas stays comma separated, whatever follows it.
  expect(readRows('\nMonth,Sales\nJan\t5').delimiter).toBe(',');
  // A leading blank line does not change a paste that has no tab.
  expect(readRows('\n\nMonth,Sales\nJan,5').delimiter).toBe(',');
});

it('a ticked header row whose number columns all hold numbers gets a note that the first row looks like data', () => {
  const note = 'The first row looks like data; untick Header row to chart it.';
  // The paste from the review: two data rows read as a header and one row.
  const eaten = must('Jan,12\nFeb,19', BAR);
  expect(eaten.table.headers).toEqual(['Jan', '12']);
  expect(eaten.notes).toEqual([note]);
  // Unticked, the same paste is two rows and no note.
  const bare = must('Jan,12\nFeb,19', { ...BAR, header: false });
  expect(bare.table.rows).toHaveLength(2);
  expect(bare.notes).toEqual([]);
  // Every number column must look like a number: one named column is a real header.
  expect(must('Month,Sales,2024\nJan,5,6', BAR).notes).toEqual([]);
  expect(must('Jan,12,Orders\nFeb,19,3', BAR).notes).toEqual([]);
  expect(must('Jan,12,13\nFeb,19,20', BAR).notes).toEqual([note]);
  // Ordinary headers, and a pie, are not noted.
  expect(must(FRUIT, BAR).notes).toEqual([]);
  expect(must('Jan,12\nFeb,19', { type: 'pie' }).notes).toEqual([note]);
  // A header row alone has no chart; the page says what to do (its own message), and the package gives nothing.
  expect(makeChart('Jan,12', BAR)).toBeNull();
});

it('the data table, the written description and the alt text show each number exactly as it was read', () => {
  const chart = must('Label,Size\nA,1234567\nB,123456789\nC,0.1', BAR);
  expect(chart.table.rows).toEqual([
    ['A', '1234567'],
    ['B', '123456789'],
    ['C', '0.1'],
  ]);
  expect(chart.alt).toContain('Largest value 123456789 (B)');
  expect(chart.alt).toContain('Smallest value 0.1 (C)');
  expect(chart.description.join(' ')).toContain('from 0.1 (C) to 123456789 (B)');
  // Another reader of the same numbers: the marks are named with the same exact numbers.
  expect(chart.svg).toContain('aria-label="A: 1234567"');
  expect(chart.svg).toContain('aria-label="B: 123456789"');
  // A pie says each slice's exact value; its total and shares are worked out, so they stay at six digits.
  const pie = must('Label,Size\nA,1234567\nB,2', { type: 'pie' });
  expect(pie.description[0]).toContain('A at 1234567 (99.9998%)');
  expect(pie.description[0]).toContain('adding up to 1234570');
  // A single value, an exponent in the paste and a long decimal.
  expect(must('Label,V\nA,1.5e3', BAR).table.rows).toEqual([['A', '1500']]);
  expect(must('Label,V\nA,0.30000000000000004', BAR).table.rows).toEqual([['A', '0.30000000000000004']]);
  expect(must('Label,V\nA,1e-7', BAR).table.rows).toEqual([['A', '0.0000001']]);
  expect(must('Label,V\nA,1e30', BAR).table.rows).toEqual([['A', '1e+30']]);
  expect(must('Label,V\nA,-0', BAR).table.rows).toEqual([['A', '0']]);
});

it('value labels on the marks show the exact number up to 12 characters and six digits beyond that', () => {
  const svg = must('Label,V\nA,1234567\nB,123456789\nC,0.1\nD,0.30000000000000004', { ...BAR, values: true }).svg;
  const written = [...svg.matchAll(/<text\b[^>]*font-size="11"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  expect(written).toEqual(['1234567', '123456789', '0.1', '0.3']);
  // The numbers on the value axis keep the short form.
  const axis = [...svg.matchAll(/<text\b[^>]*text-anchor="end"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  expect(axis.every((t) => t === String(Number(t)))).toBe(true);
  // A pie legend and its slice labels follow the same rule.
  const pie = must('Label,V\nA,1234567\nB,0.30000000000000004', { type: 'pie', values: true }).svg;
  expect(pie).toContain('>A: 1234567<');
  expect(pie).toContain('>B: 0.3<');
});
