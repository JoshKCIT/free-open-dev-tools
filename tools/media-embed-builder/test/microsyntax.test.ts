import { it, expect } from 'vitest';
import {
  compareTyped,
  daysInMonth,
  isValidDate,
  isValidDateOrGlobalDateTime,
  isValidDuration,
  isValidFloat,
  isValidGlobalDateTime,
  isValidInteger,
  isValidLocalDateTime,
  isValidMonth,
  isValidNonNegativeInteger,
  isValidTime,
  isValidTimeElementValue,
  isValidTimeZoneOffset,
  isValidWeek,
  isValidYear,
  isValidYearlessDate,
  parseValidFloat,
  weeksInYear,
} from '../src/microsyntax';

/** Writes every ASCII digit of a string as an Arabic-Indic digit (U+0660 to U+0669). */
function arabicIndic(s: string): string {
  return s.replace(/[0-9]/g, (d) => String.fromCodePoint(0x660 + Number(d)));
}

/** Writes every ASCII digit of a string as a fullwidth digit (U+FF10 to U+FF19). */
function fullwidth(s: string): string {
  return s.replace(/[0-9]/g, (d) => String.fromCodePoint(0xff10 + Number(d)));
}

it('WHATWG 2.3.4.3 valid floating-point numbers: no leading plus, no trailing point, no NaN or Infinity', () => {
  for (const ok of ['1', '-1.5', '.5', '1e3', '1E-3', '0', '10.25', '1e+3', '-0.5e-2', '00012', '-.5', '0.0']) {
    expect(isValidFloat(ok), ok).toBe(true);
  }
  for (const bad of [
    '+1',
    '5.',
    'NaN',
    'Infinity',
    '-Infinity',
    '1,5',
    '0x10',
    '',
    '-',
    '.',
    '1e',
    'e5',
    '1.2.3',
    ' 1',
    '1 ',
    '1e3.5',
    '--1',
  ]) {
    expect(isValidFloat(bad), JSON.stringify(bad)).toBe(false);
  }
  // Only ASCII digits count, so an Arabic-Indic or a fullwidth digit is not a digit here.
  expect(isValidFloat('٣')).toBe(false);
  expect(isValidFloat('1.٥')).toBe(false);
  expect(isValidFloat('１')).toBe(false);
  // The rules for parsing floating-point number values: nearest double, never an infinity, never negative zero.
  expect(parseValidFloat('1e3')).toBe(1000);
  expect(parseValidFloat('.5')).toBe(0.5);
  expect(parseValidFloat('-1.5')).toBe(-1.5);
  expect(parseValidFloat('1E-3')).toBe(0.001);
  expect(parseValidFloat('1e999')).toBeNull();
  expect(parseValidFloat('-1e999')).toBeNull();
  expect(Object.is(parseValidFloat('-0'), 0)).toBe(true);
  expect(parseValidFloat('5.')).toBeNull();
  expect(parseValidFloat('abc')).toBeNull();
});

it('WHATWG 2.3.4 valid non-negative integers and valid integers are ASCII digits only', () => {
  for (const ok of ['0', '7', '007', '1234567890123456789012345678901234567890']) {
    expect(isValidNonNegativeInteger(ok), ok).toBe(true);
    expect(isValidInteger(ok), ok).toBe(true);
  }
  for (const bad of ['', '-1', '+1', '1.0', '1e3', ' 1', '1 ', '0x1', '٣', '１２']) {
    expect(isValidNonNegativeInteger(bad), JSON.stringify(bad)).toBe(false);
  }
  // A valid integer may carry one hyphen-minus; a plus sign is parsed by browsers but is not conforming.
  expect(isValidInteger('-12')).toBe(true);
  expect(isValidInteger('-0')).toBe(true);
  for (const bad of ['', '-', '--1', '+3', '- 1', '1-', '-٣']) {
    expect(isValidInteger(bad), JSON.stringify(bad)).toBe(false);
  }
});

it('WHATWG 2.3.5 every date and time example of the standard is valid', () => {
  // WHATWG 2.3.5.1 to 2.3.5.9 and the time element of 4.5.14.
  expect(isValidMonth('2011-11')).toBe(true);
  expect(isValidMonth('12345-01')).toBe(true);
  for (const date of ['2011-11-18', '2012-02-29', '2000-02-29', '0001-01-01', '12345-06-30']) {
    expect(isValidDate(date), date).toBe(true);
  }
  for (const yearless of ['11-18', '--11-18', '02-29', '12-31'])
    expect(isValidYearlessDate(yearless), yearless).toBe(true);
  for (const time of ['14:54', '14:54:39', '14:54:39.929', '14:54:39.9', '14:54:39.92', '00:00', '23:59:59']) {
    expect(isValidTime(time), time).toBe(true);
  }
  for (const local of [
    '2011-11-18T14:54',
    '2011-11-18T14:54:39',
    '2011-11-18T14:54:39.929',
    '2011-11-18 14:54',
    '2011-11-18 14:54:39.929',
  ]) {
    expect(isValidLocalDateTime(local), local).toBe(true);
  }
  for (const zone of ['Z', '+0000', '+00:00', '-0800', '-08:00', '+23:59', '-23:59', '+0209']) {
    expect(isValidTimeZoneOffset(zone), zone).toBe(true);
  }
  for (const global of [
    '2011-11-18T14:54Z',
    '2011-11-18T14:54:39.929Z',
    '2011-11-18T14:54+0000',
    '2011-11-18T06:54-0800',
    '2011-11-18T06:54:39.929-08:00',
    '2011-11-18 14:54Z',
    '2011-11-18 06:54:39-08:00',
    // WHATWG 2.3.5.7 examples
    '0037-12-13 00:00Z',
    '1979-10-14T12:00:00.001-04:00',
    '8592-01-01T02:09+02:09',
  ]) {
    expect(isValidGlobalDateTime(global), global).toBe(true);
  }
  expect(isValidWeek('2011-W47')).toBe(true);
  expect(isValidYear('2011')).toBe(true);
  expect(isValidYear('0001')).toBe(true);
  expect(isValidDuration('PT4H18M3S')).toBe(true);
  expect(isValidDuration('4h 18m 3s')).toBe(true);
  // The time element accepts each of its ten forms and nothing else (WHATWG 4.5.14).
  for (const value of [
    '2011-11',
    '2011-11-18',
    '11-18',
    '14:54:39.929',
    '2011-11-18T14:54',
    'Z',
    '-08:00',
    '2011-11-18T06:54-0800',
    '2011-W47',
    '2011',
    '0001',
    'PT4H18M3S',
    '4h 18m 3s',
  ]) {
    expect(isValidTimeElementValue(value), value).toBe(true);
  }
  for (const value of ['', 'soon', '2011-13', '0000', '37-12-13', '2011-11-18T']) {
    expect(isValidTimeElementValue(value), JSON.stringify(value)).toBe(false);
  }
  // Leap years: divisible by 400, or by 4 and not by 100.
  expect(daysInMonth(2000, 2)).toBe(29);
  expect(daysInMonth(1900, 2)).toBe(28);
  expect(daysInMonth(2100, 2)).toBe(28);
  expect(daysInMonth(2024, 2)).toBe(29);
  expect(daysInMonth(2023, 2)).toBe(28);
  expect(daysInMonth(2023, 4)).toBe(30);
  expect(daysInMonth(2023, 12)).toBe(31);
  expect(daysInMonth(10n ** 30n, 2)).toBe(29);
});

it('WHATWG 2.3.5 impossible dates and times are refused: month 13, February 29 in a common year, hour 24, second 60, four fraction digits and a minus zero offset', () => {
  expect(isValidDate('2011-13-45')).toBe(false);
  expect(isValidMonth('2011-13')).toBe(false);
  expect(isValidMonth('2011-00')).toBe(false);
  expect(isValidMonth('0000-01')).toBe(false);
  expect(isValidMonth('011-01')).toBe(false);
  for (const bad of [
    '2011-02-29',
    '1900-02-29',
    '2100-02-29',
    '2011-04-31',
    '2011-00-10',
    '2011-11-00',
    '2011-11-32',
    '0000-01-01',
    '37-12-13',
    '2011-1-18',
    '2011-11-8',
    '2011/11/18',
  ]) {
    expect(isValidDate(bad), bad).toBe(false);
  }
  expect(isValidYearlessDate('02-30')).toBe(false);
  expect(isValidYearlessDate('13-01')).toBe(false);
  expect(isValidYearlessDate('---11-18')).toBe(false);
  expect(isValidYearlessDate('-11-18')).toBe(false);
  for (const bad of [
    '24:00',
    '14:54:60',
    '14:54:39.9291',
    '14:60',
    '1:54',
    '14:5',
    '14:54:39.',
    '14:54.5',
    '14:54:3',
    '14:54:39,5',
    '14:54:61',
    ' 14:54',
    '14:54 ',
  ]) {
    expect(isValidTime(bad), JSON.stringify(bad)).toBe(false);
  }
  for (const bad of ['-00:00', '-0000', '+24:00', '+00:60', 'z', '+1:00', '+000', '08:00', '+08:0']) {
    expect(isValidTimeZoneOffset(bad), bad).toBe(false);
  }
  for (const bad of [
    '2011-11-18T24:00',
    '2011-11-18t14:54',
    '2011-11-18  14:54',
    '2011-11-18T14:54Z',
    '2011-13-18T14:54',
    '2011-11-18',
  ]) {
    expect(isValidLocalDateTime(bad), bad).toBe(false);
  }
  for (const bad of [
    '2001-12-21  12:00Z',
    '2011-11-18T14:54',
    '2011-11-18T14:54-00:00',
    '2011-11-18T24:00Z',
    '2011-11-18T14:54z',
    '2011-11-18T14:54:60Z',
    '2011-11-18Z',
    '14:54Z',
  ]) {
    expect(isValidGlobalDateTime(bad), bad).toBe(false);
  }
});

it('WHATWG 2.3.5 week 53 exists only in years that have 53 weeks', () => {
  // A year has 53 weeks when 1 January is a Thursday, or a Wednesday in a leap year.
  for (const year of [2004, 2009, 2015, 2020, 2026, 2032]) expect(weeksInYear(year), String(year)).toBe(53);
  for (const year of [2011, 2014, 2016, 2021, 2023, 2024, 2025, 1900, 2000, 1])
    expect(weeksInYear(year), String(year)).toBe(52);
  expect(isValidWeek('2015-W53')).toBe(true);
  expect(isValidWeek('2020-W53')).toBe(true);
  expect(isValidWeek('2011-W53')).toBe(false);
  // 1 January 2014 is a Wednesday but 2014 is not a leap year.
  expect(isValidWeek('2014-W53')).toBe(false);
  expect(isValidWeek('2011-W52')).toBe(true);
  expect(isValidWeek('2011-W01')).toBe(true);
  for (const bad of ['2011-W00', '2011-W54', '2011-W5', '2011-w47', '2011W47', '0000-W01', '011-W01', '2011-W47 ']) {
    expect(isValidWeek(bad), bad).toBe(false);
  }
  // The arithmetic never uses a Date object, so years below 100 and above 9999 are right.
  expect(weeksInYear(10n ** 20n + 4n)).toBeGreaterThanOrEqual(52);
  expect(isValidWeek('12345-W01')).toBe(true);
});

it('WHATWG 2.3.5 durations in both the P form and the human form are valid', () => {
  for (const ok of [
    'PT4H18M3S',
    'P1D',
    'P1DT2H',
    'PT0S',
    'PT3.5S',
    'PT3.123S',
    'P4D',
    'PT30M',
    'P2DT1H1M1S',
    '4h 18m 3s',
    '1w 2d',
    '  4h  18m ',
    '3.5s',
    '90m',
    '1D',
    '2 W',
    '0s',
  ]) {
    expect(isValidDuration(ok), JSON.stringify(ok)).toBe(true);
  }
  // Months and years cannot be written, fractions belong to seconds only, and each unit is used once.
  for (const bad of [
    '',
    'P',
    'PT',
    'P1Y',
    'P1M',
    'PT1.5H',
    'PT3.1234S',
    'P1DT',
    '4h 4h',
    '1h 60m 3.5',
    '3.5m',
    '.5s',
    'pt4h',
    'PT4H18M3S ',
    'P1W',
    '4 hours',
    '1w 1W',
  ]) {
    expect(isValidDuration(bad), JSON.stringify(bad)).toBe(false);
  }
});

it('a date or a global date and time is accepted where the standard asks for a date with optional time, and a local date and time is not', () => {
  // WHATWG 4.7.1 and 2.3.5.10: the datetime value of ins and del.
  for (const ok of ['2009-10-11T01:25-07:00', '2005-03-16 00:00Z', '2011-11-18', '2011-11-18T14:54:39.929Z']) {
    expect(isValidDateOrGlobalDateTime(ok), ok).toBe(true);
  }
  for (const bad of [
    '2011-11-18T14:54',
    '2011-11-18 14:54:39',
    '14:54',
    '2011-11',
    '2011-W47',
    'Z',
    '2011-02-29',
    '',
  ]) {
    expect(isValidDateOrGlobalDateTime(bad), JSON.stringify(bad)).toBe(false);
  }
  // Ordering of the typed strings, used for min and max.
  expect(compareTyped('number', '5', '10')).toBe(-1);
  expect(compareTyped('number', '1e1', '10')).toBe(0);
  expect(compareTyped('number', '-.5', '-1')).toBe(1);
  expect(compareTyped('date', '2024-02-29', '2024-03-01')).toBe(-1);
  expect(compareTyped('date', '12345-01-01', '9999-12-31')).toBe(1);
  expect(compareTyped('month', '2024-12', '2025-01')).toBe(-1);
  expect(compareTyped('week', '2020-W53', '2021-W01')).toBe(-1);
  expect(compareTyped('time', '06:00', '21:00')).toBe(-1);
  expect(compareTyped('time', '14:54:39.9', '14:54:39.900')).toBe(0);
  expect(compareTyped('time', '14:54:39.09', '14:54:39.9')).toBe(-1);
  expect(compareTyped('datetime-local', '2024-01-01T10:00', '2024-01-01 09:59:59.999')).toBe(1);
  expect(() => compareTyped('date', '2024-02-30', '2024-03-01')).toThrow();
});

it('digits other than ASCII digits are refused in every number, date and time string', () => {
  const valid: [string, (s: string) => boolean][] = [
    ['12', isValidNonNegativeInteger],
    ['-12', isValidInteger],
    ['12.5e3', isValidFloat],
    ['2011-11', isValidMonth],
    ['2011-11-18', isValidDate],
    ['11-18', isValidYearlessDate],
    ['14:54:39.929', isValidTime],
    ['2011-11-18T14:54:39', isValidLocalDateTime],
    ['+08:00', isValidTimeZoneOffset],
    ['2011-11-18T06:54:39.929-08:00', isValidGlobalDateTime],
    ['2011-W47', isValidWeek],
    ['2011', isValidYear],
    ['PT4H18M3S', isValidDuration],
    ['4h 18m 3s', isValidDuration],
    ['2011-11-18', isValidDateOrGlobalDateTime],
    ['2011-11-18T14:54', isValidTimeElementValue],
  ];
  for (const [sample, validator] of valid) {
    expect(validator(sample), sample).toBe(true);
    expect(validator(arabicIndic(sample)), 'Arabic-Indic ' + sample).toBe(false);
    expect(validator(fullwidth(sample)), 'fullwidth ' + sample).toBe(false);
  }
  expect(parseValidFloat(arabicIndic('12'))).toBeNull();
});
