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
