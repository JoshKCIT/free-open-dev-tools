import { it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  D,
  MoneyInputError,
  DISPLAY_LOCALE,
  isBlank,
  parseDecimal,
  roundTo,
  toPlain,
  minorUnits,
  formatMoney,
  currencyCodes,
  parseCurrency,
  parseCount,
  parseIsoDate,
  formatIsoDate,
  addMonthsClamped,
  addDays,
  daysBetween,
  parseRows,
  cellDecimal,
  cellText,
  csvCell,
} from '../src/money';

/** Runs `fn` and returns the MoneyInputError it throws, failing the test if it throws anything else or nothing. */
function refused(fn: () => unknown): MoneyInputError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MoneyInputError);
    return err as MoneyInputError;
  }
  throw new Error('expected a MoneyInputError but nothing was thrown');
}

it('decimal.js is used through its own clone with 40 significant digits and half away from zero rounding, and the global defaults stay untouched', () => {
  // Library defaults read from the installed decimal.js 10.6.0 (decimal.d.ts and a scratch run):
  // precision 20, rounding 4 (ROUND_HALF_UP), toExpNeg -7, toExpPos 21.
  expect(Decimal.precision).toBe(20);
  expect(Decimal.rounding).toBe(Decimal.ROUND_HALF_UP);
  expect(Decimal.toExpNeg).toBe(-7);
  expect(Decimal.toExpPos).toBe(21);

  expect(D.precision).toBe(40);
  expect(D.rounding).toBe(D.ROUND_HALF_UP);
  expect(D.toExpNeg).toBe(-40);
  expect(D.toExpPos).toBe(40);

  // One third keeps 40 significant digits through the clone and only 20 through the global constructor.
  expect(new D(1).div(3).toString()).toBe('0.' + '3'.repeat(40));
  expect(new Decimal(1).div(3).toString()).toBe('0.' + '3'.repeat(20));
  // Small values print in plain notation, not 1e-30.
  expect(new D('1e-30').toString()).toBe('0.000000000000000000000000000001');
  // Importing and using the clone did not change the library's own settings.
  expect(Decimal.precision).toBe(20);
  expect(DISPLAY_LOCALE).toBe('en-US');
});

it('0.1 plus 0.2 is exactly 0.3 with this snippet while the float sum is not', () => {
  // The float really is wrong: IEEE 754 doubles give 0.30000000000000004.
  const floatSum = 0.1 + 0.2;
  expect(floatSum).not.toBe(0.3);
  expect(String(floatSum)).toBe('0.30000000000000004');
  const exact = parseDecimal('0.1', 'first').plus(parseDecimal('0.2', 'second'));
  expect(exact.toFixed()).toBe('0.3');
  expect(exact.equals(parseDecimal('0.3', 'sum'))).toBe(true);
});

it('only plain decimal text is accepted: NaN, Infinity, hex, binary, exponents, underscores, commas and empty text are refused naming the field', () => {
  for (const [text, expected] of [
    ['1234.50', '1234.5'],
    ['.5', '0.5'],
    ['5.', '5'],
    ['+5', '5'],
    ['  7  ', '7'],
    ['0', '0'],
    ['0000000000000000000000012', '12'], // leading zeros do not count against the digit cap
  ] as const) {
    expect(parseDecimal(text, 'Amount').toFixed()).toBe(expected);
  }
  expect(parseDecimal('-0.005', 'Amount', { allowNegative: true }).toFixed()).toBe('-0.005');

  for (const bad of [
    '1,234',
    '1e5',
    '1E5',
    '1e1000000',
    '0x1A',
    '0b11',
    'NaN',
    'Infinity',
    '-Infinity',
    '1_000',
    '1 000',
    '$5',
    '5%',
    '--5',
    '1.2.3',
    '1..2',
    '-',
    '.',
    '+',
    '١٢',
  ]) {
    const err = refused(() => parseDecimal(bad, 'Loan amount'));
    expect(err.field, bad).toBe('Loan amount');
    expect(err.message.length).toBeGreaterThan(10);
  }
  // Empty and whitespace-only text is reported as missing, with an example value.
  for (const blank of ['', '   ', '\t\n']) {
    const err = refused(() => parseDecimal(blank, 'Loan amount'));
    expect(err.field).toBe('Loan amount');
    expect(err.message).toMatch(/^missing, type a value such as /);
    expect(isBlank(blank)).toBe(true);
  }
  expect(isBlank(' 0 ')).toBe(false);
  // A negative value is refused unless the caller allows it.
  const negative = refused(() => parseDecimal('-5', 'Amount'));
  expect(negative.field).toBe('Amount');
  expect(negative.message).toMatch(/negative/);
});

it('at most 15 digits before the point and 12 after are accepted and one more is refused', () => {
  const fifteen = '9'.repeat(15);
  const twelve = '1'.repeat(12);
  expect(parseDecimal(fifteen, 'Amount').toFixed()).toBe(fifteen);
  expect(parseDecimal(`${fifteen}.${twelve}`, 'Amount').toFixed()).toBe(`${fifteen}.${twelve}`);
  expect(parseDecimal(`0.${twelve}`, 'Amount').toFixed()).toBe(`0.${twelve}`);

  for (const text of ['9'.repeat(16), `1.${'1'.repeat(13)}`, `${'9'.repeat(16)}.5`]) {
    const err = refused(() => parseDecimal(text, 'Sale price'));
    expect(err.field).toBe('Sale price');
    expect(err.message).toContain('15');
    expect(err.message).toContain('12');
  }
  // The caps can be tightened by the caller and the message names the caps that applied.
  expect(parseDecimal('12.34', 'Years', { maxInt: 2, maxFrac: 2 }).toFixed()).toBe('12.34');
  const tight = refused(() => parseDecimal('123', 'Years', { maxInt: 2, maxFrac: 2 }));
  expect(tight.message).toContain('2 before');
});

it('ties round half away from zero: 0.005, -0.005, 2.5, -2.5 and 1.005', () => {
  expect(roundTo(new D('0.005'), 2).toFixed(2)).toBe('0.01');
  expect(roundTo(new D('-0.005'), 2).toFixed(2)).toBe('-0.01');
  expect(roundTo(new D('2.5'), 0).toFixed(0)).toBe('3');
  expect(roundTo(new D('-2.5'), 0).toFixed(0)).toBe('-3');
  // 1.005 is a tie in decimal text; a float would see 1.00499999999999989... and give 1.00.
  expect(roundTo(new D('1.005'), 2).toFixed(2)).toBe('1.01');
  expect(Number((1.005).toFixed(2))).toBe(1);
  // Not a tie: below half goes down, above half goes up.
  expect(roundTo(new D('0.0049999'), 2).toFixed(2)).toBe('0.00');
  expect(roundTo(new D('0.0050001'), 2).toFixed(2)).toBe('0.01');
  // toPlain rounds the same way and always prints the places asked for.
  expect(toPlain(new D('2.5'), 0)).toBe('3');
  expect(toPlain(new D('-2.5'), 0)).toBe('-3');
  expect(toPlain(new D('1.005'), 2)).toBe('1.01');
  expect(toPlain(new D('1'), 3)).toBe('1.000');
});

it('ISO 4217 minor units come from Intl: USD 2, JPY 0 and BHD 3, and a value that rounds to zero prints without a minus sign', () => {
  expect(minorUnits('USD')).toBe(2);
  expect(minorUnits('JPY')).toBe(0);
  expect(minorUnits('BHD')).toBe(3);

  expect(formatMoney(new D('1234.565'))).toBe('$1,234.57');
  expect(formatMoney(new D('1234.565'), 'USD')).toBe('$1,234.57');
  expect(formatMoney(new D('-1234.565'))).toBe('-$1,234.57');
  expect(formatMoney(new D('1234.5'), 'JPY')).toBe('¥1,235');
  expect(formatMoney(new D('1.0005'), 'BHD')).toMatch(/1\.001$/);
  expect(formatMoney(new D('0'))).toBe('$0.00');
  // -0.004 rounds to zero: it must read $0.00, never -$0.00.
  expect(formatMoney(new D('-0.004'))).toBe('$0.00');
  expect(toPlain(new D('-0.004'), 2)).toBe('0.00');
  expect(toPlain(new D('-0.4'), 0)).toBe('0');
  // A 17 digit amount is formatted from its decimal string, so no float rounding creeps in.
  expect(formatMoney(new D('12345678901234567.89'))).toBe('$12,345,678,901,234,567.89');
});

it('a currency code must be one the browser reports, and a malformed or unknown code is refused naming the field', () => {
  expect(parseCurrency('usd', 'Currency')).toBe('USD');
  expect(parseCurrency(' eur ', 'Currency')).toBe('EUR');
  expect(parseCurrency('JPY', 'Currency')).toBe('JPY');

  const list = currencyCodes();
  if (list !== null) {
    expect(list).toContain('USD');
    expect(list).toContain('JPY');
  }
  for (const bad of ['US', 'USDD', '12', 'U$D', 'EURO', 'QQQ']) {
    const err = refused(() => parseCurrency(bad, 'Currency (ISO 4217 code)'));
    expect(err.field, bad).toBe('Currency (ISO 4217 code)');
  }
  const blank = refused(() => parseCurrency('  ', 'Currency (ISO 4217 code)'));
  expect(blank.message).toMatch(/^missing, type a code such as USD/);
});

it('whole-number counts are accepted only inside their stated range, so the large negative tracer the browser harness types is refused', () => {
  expect(parseCount('12', 'Months', 1, 600)).toBe(12);
  expect(parseCount(' 007 ', 'Months', 1, 600)).toBe(7);
  expect(parseCount('1', 'Months', 1, 600)).toBe(1);
  expect(parseCount('600', 'Months', 1, 600)).toBe(600);
  expect(parseCount('0', 'Rows', 0, 20)).toBe(0);

  for (const bad of [
    '0',
    '601',
    '-98765',
    '-987654321',
    '1.5',
    '1e3',
    '1,000',
    '+5',
    '12 months',
    'abc',
    '1000000000000',
  ]) {
    const err = refused(() => parseCount(bad, 'Months', 1, 600));
    expect(err.field, bad).toBe('Months');
    expect(err.message, bad).toContain('1 to 600');
  }
  // The harness types a large negative integer such as -98765432109 into count-like fields; it must never loop or pass.
  const tracer = refused(() => parseCount('-98765432109', 'Years', 1, 50));
  expect(tracer.field).toBe('Years');
  // Even a huge upper bound cannot admit a digit string longer than 9 digits.
  expect(() => parseCount('1234567890', 'Rows', 1, 999999999999)).toThrow(MoneyInputError);
  // Blank is missing, with an example.
  const blank = refused(() => parseCount('  ', 'Months', 1, 600));
  expect(blank.message).toMatch(/^missing, type a whole number such as /);
});

it('ISO 8601 calendar dates are read in UTC, impossible dates are refused, and months added to the 31st fall back to the last day of shorter months', () => {
  // ISO 8601 calendar date YYYY-MM-DD; 2024 is a leap year, 2023 and 1900 are not.
  const jan31 = parseIsoDate('2024-01-31', 'First payment date');
  expect(jan31).toEqual({ year: 2024, month: 1, day: 31 });
  expect(formatIsoDate(jan31)).toBe('2024-01-31');
  expect(formatIsoDate(parseIsoDate(' 1900-01-01 ', 'Date'))).toBe('1900-01-01');
  expect(formatIsoDate(parseIsoDate('2200-12-31', 'Date'))).toBe('2200-12-31');
  expect(formatIsoDate(parseIsoDate('2024-02-29', 'Date'))).toBe('2024-02-29');

  for (const bad of [
    '2023-02-29',
    '1900-02-29',
    '2024-02-30',
    '2024-04-31',
    '2024-13-01',
    '2024-00-10',
    '2024-01-00',
    '1899-12-31',
    '2201-01-01',
    '2024-1-5',
    '20240131',
    '2024/01/31',
    '31-01-2024',
    '2024-01-31T00:00:00Z',
  ]) {
    const err = refused(() => parseIsoDate(bad, 'First payment date'));
    expect(err.field, bad).toBe('First payment date');
  }
  expect(refused(() => parseIsoDate('', 'First payment date')).message).toMatch(/^missing, type a date such as /);

  // Months are added to the first date, not chained: 31 January, 29 February 2024, 31 March, 30 April.
  const months = [0, 1, 2, 3, 12, 13, 24, 25].map((m) => formatIsoDate(addMonthsClamped(jan31, m)));
  expect(months).toEqual([
    '2024-01-31',
    '2024-02-29',
    '2024-03-31',
    '2024-04-30',
    '2025-01-31',
    '2025-02-28',
    '2026-01-31',
    '2026-02-28',
  ]);
  expect(formatIsoDate(addMonthsClamped(parseIsoDate('2024-11-30', 'Date'), 3))).toBe('2025-02-28');
  expect(formatIsoDate(addMonthsClamped(parseIsoDate('2024-12-15', 'Date'), 1))).toBe('2025-01-15');

  // Days are added in UTC, so a clock change in the viewer's own time zone cannot move a date.
  const before = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Europe/London', 'America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = tz;
      expect(formatIsoDate(addDays(parseIsoDate('2024-03-30', 'Date'), 1)), tz).toBe('2024-03-31');
      expect(formatIsoDate(addDays(parseIsoDate('2024-03-30', 'Date'), 2)), tz).toBe('2024-04-01');
      expect(formatIsoDate(addDays(parseIsoDate('2024-10-26', 'Date'), 2)), tz).toBe('2024-10-28');
      expect(formatIsoDate(addDays(parseIsoDate('2024-02-28', 'Date'), 1)), tz).toBe('2024-02-29');
      expect(formatIsoDate(addDays(parseIsoDate('2024-12-31', 'Date'), 1)), tz).toBe('2025-01-01');
      expect(formatIsoDate(addDays(parseIsoDate('2024-01-01', 'Date'), -1)), tz).toBe('2023-12-31');
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

it('day counts between two dates include leap days and an end before the start is refused', () => {
  const d = (text: string) => parseIsoDate(text, 'Date');
  expect(daysBetween(d('2024-02-28'), d('2024-03-01'))).toBe(2); // 29 February 2024 exists
  expect(daysBetween(d('2023-02-28'), d('2023-03-01'))).toBe(1);
  expect(daysBetween(d('2024-01-01'), d('2025-01-01'))).toBe(366);
  expect(daysBetween(d('2023-01-01'), d('2024-01-01'))).toBe(365);
  expect(daysBetween(d('2024-05-05'), d('2024-05-05'))).toBe(0);
  // 1900-01-01 to 2200-12-31: 301 years of 365 days, plus 73 leap days (every fourth year 1904 to 2196 except 2100), less 1.
  expect(daysBetween(d('1900-01-01'), d('2200-12-31'))).toBe(301 * 365 + 73 - 1);
  const err = refused(() => daysBetween(d('2024-03-01'), d('2024-02-28')));
  expect(err.message).toMatch(/before/);
});

const CARDS = { columns: ['name', 'balance', 'APR', 'minimum'], required: 4, maxRows: 20 } as const;

it('rows are one per line split on the vertical bar, blank lines are skipped and a bad cell is reported with its line and column', () => {
  const rows = parseRows('Card A | 1000 | 24 | 25\n\nCard B | 500 | 12 | 25', 'Cards', CARDS);
  // Rows come back in the order typed, and line numbers count the blank line: Card B is on line 3.
  expect(rows.map((r) => r.line)).toEqual([1, 3]);
  expect(rows[0]!.cells).toEqual(['Card A', '1000', '24', '25']);
  expect(rows[1]!.cells).toEqual(['Card B', '500', '12', '25']);
  // Columns are 1-based and point at the first character of each trimmed cell: "Card A | 1000 | 24 | 25".
  expect(rows[0]!.starts).toEqual([1, 10, 17, 22]);
  expect(cellText(rows[0]!, 0)).toBe('Card A');
  expect(cellText(rows[0]!, 9)).toBe('');
  expect(cellDecimal(rows[0]!, 1, 'Cards', 'balance').toFixed()).toBe('1000');
  expect(cellDecimal(rows[0]!, 2, 'Cards', 'APR').toFixed()).toBe('24');

  // Windows line ends, blank lines made of spaces and a final line without a line end all work.
  const windows = parseRows('\r\n  \r\nA | 1 | 2 | 3\r\nB | 4 | 5 | 6\r\n', 'Cards', CARDS);
  expect(windows.map((r) => r.line)).toEqual([3, 4]);
  expect(windows[1]!.cells[3]).toBe('6');
  // Nothing typed is no rows, not an error.
  expect(parseRows('', 'Cards', CARDS)).toEqual([]);
  expect(parseRows('  \n \n', 'Cards', CARDS)).toEqual([]);

  // A bad number names the line, the column where the cell starts and the column heading.
  const comma = parseRows('Card A | 1000 | 24 | 25\n\nCard B | 12,5 | 12 | 25', 'Cards', CARDS);
  const err = refused(() => cellDecimal(comma[1]!, 1, 'Cards', 'balance'));
  expect(err.field).toBe('Cards');
  expect(err.line).toBe(3);
  expect(err.column).toBe(10);
  expect(err.message).toContain('balance');
  // A negative cell is refused unless the caller allows it, and an empty cell is reported as missing.
  expect(refused(() => cellDecimal(parseRows('A | -5 | 1 | 1', 'Cards', CARDS)[0]!, 1, 'Cards', 'balance')).line).toBe(
    1,
  );
  expect(
    cellDecimal(parseRows('A | -5 | 1 | 1', 'Cards', CARDS)[0]!, 1, 'Cards', 'balance', {
      allowNegative: true,
    }).toFixed(),
  ).toBe('-5');
  const empty = refused(() => cellDecimal(parseRows('A || 1 | 1', 'Cards', CARDS)[0]!, 1, 'Cards', 'balance'));
  expect(empty.message).toMatch(/missing/);
  expect(empty.column).toBe(4);

  // Too few cells: line and the column where the next cell would go, with the expected format named.
  const few = refused(() => parseRows('Card A | 1000 | 24', 'Cards', CARDS));
  expect(few.field).toBe('Cards');
  expect(few.line).toBe(1);
  expect(few.column).toBe(19);
  expect(few.message).toContain('name | balance | APR | minimum');
  // Too many cells: the column of the first extra one.
  const many = refused(() => parseRows('ok | 1 | 2 | 3\nCard A | 1000 | 24 | 25 | 9', 'Cards', CARDS));
  expect(many.line).toBe(2);
  expect(many.column).toBe(27);
  // Optional trailing columns may be left off.
  const optional = parseRows('A | 1 | 2', 'Cards', { ...CARDS, required: 3 });
  expect(optional[0]!.cells).toEqual(['A', '1', '2']);
  expect(cellText(optional[0]!, 3)).toBe('');
});

it('a row list longer than its cap is refused with the cap named', () => {
  const lines = Array.from({ length: 21 }, (_, i) => `Card ${i + 1} | 100 | 10 | 5`);
  const err = refused(() => parseRows(lines.join('\n'), 'Cards', CARDS));
  expect(err.field).toBe('Cards');
  expect(err.message).toContain('20');
  expect(err.line).toBe(21);
  // Exactly the cap is fine, and blank lines never count towards it.
  expect(parseRows(lines.slice(0, 20).join('\n\n'), 'Cards', CARDS)).toHaveLength(20);
});

it('when Intl.supportedValuesOf is missing a well formed code the formatter accepts is used and a malformed one is still refused', () => {
  const original = Object.getOwnPropertyDescriptor(Intl, 'supportedValuesOf');
  try {
    Object.defineProperty(Intl, 'supportedValuesOf', { value: undefined, configurable: true, writable: true });
    expect(currencyCodes()).toBeNull();
    expect(parseCurrency('eur', 'Currency')).toBe('EUR');
    expect(parseCurrency(' jpy ', 'Currency')).toBe('JPY');
    for (const bad of ['EURO', 'EU', 'E1R', 'U$D', '€', '']) {
      expect(refused(() => parseCurrency(bad, 'Currency')).field, bad).toBe('Currency');
    }
    // Formatting still works without the list.
    expect(formatMoney(new D('1234.5'), 'EUR')).toBe('€1,234.50');
  } finally {
    if (original) Object.defineProperty(Intl, 'supportedValuesOf', original);
    else delete (Intl as { supportedValuesOf?: unknown }).supportedValuesOf;
  }
  // With the list restored, the list is used again.
  expect(currencyCodes()).not.toBeNull();
});

it('a CSV text cell starting with an equals sign, plus, minus or at sign is neutralised and numbers are left alone', () => {
  // OWASP CSV injection: a text cell that starts with = + - @ (or a tab or carriage return) can run as a formula
  // when the file is opened in a spreadsheet, so it gets a leading apostrophe and is quoted.
  expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
  expect(csvCell('+1+1x')).toBe(`"'+1+1x"`);
  expect(csvCell('-cmd|x')).toBe(`"'-cmd|x"`);
  expect(csvCell('@SUM(1)')).toBe(`"'@SUM(1)"`);
  expect(csvCell('\tcmd')).toBe(`"'\tcmd"`);
  expect(csvCell('=1,2')).toBe(`"'=1,2"`);
  // RFC 4180 quoting: commas, quotes and line breaks put the cell in quotes, and a quote is doubled.
  expect(csvCell('Coffee, large')).toBe('"Coffee, large"');
  expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  expect(csvCell('two\nlines')).toBe('"two\nlines"');
  expect(csvCell('two\r\nlines')).toBe('"two\r\nlines"');
  // Plain text, empty text and numbers (including signed ones) are left alone.
  expect(csvCell('Coffee')).toBe('Coffee');
  expect(csvCell('')).toBe('');
  for (const number of ['12.50', '-5', '+5', '.5', '1234', '-0.005']) expect(csvCell(number)).toBe(number);
  // A dash on its own is not a number.
  expect(csvCell('-')).toBe(`"'-"`);
});
