/**
 * Dates in a spreadsheet are numbers: a count of days, with the time of day as a fraction. Whether a number IS a date is
 * decided only by its cell's number format, so this module reads formats and turns serials into ISO text. Nothing here
 * runs unless a cell's format says date or time, and the converter can be asked to skip it and show serials.
 */
import { SpreadsheetConverterError } from './types';

/** What a number format makes a number: a date (with or without a time), or a time of day on its own. */
export type FormatClass = 'date' | 'time';

// ECMA-376 Part 1, 18.8.30 numFmt: the built-in format ids that hold dates or times. 14 to 17 and 22 are dates (22 with
// a time); 18 to 21 are times; 45 to 47 are minute-and-second or elapsed forms; 27 to 36 and 50 to 58 are East Asian
// date and time forms, of which 32 to 35, 52, 53, 55 and 56 hold only a time.
const BUILT_IN_DATE_IDS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 36, 50, 51, 54, 57, 58]);
const BUILT_IN_TIME_IDS = new Set([18, 19, 20, 21, 32, 33, 34, 35, 45, 46, 47, 52, 53, 55, 56]);

export function builtInFormatClass(id: number): FormatClass | undefined {
  if (BUILT_IN_DATE_IDS.has(id)) return 'date';
  if (BUILT_IN_TIME_IDS.has(id)) return 'time';
  return undefined;
}

/**
 * Reads a custom format code. Text in quotes, escaped characters, `_x` spacing, `*x` fill and bracketed parts (colours,
 * conditions, locales) say nothing about dates and are removed first; an elapsed-time bracket such as [h] counts as a
 * time. A format with y or d, or a month, is a date; one with only h, s or minutes is a time.
 */
export function customFormatClass(code: string): FormatClass | undefined {
  if (/^\s*general\s*$/i.test(code)) return undefined;
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')
    .replace(/\[(?:h+|m+|s+)\]/gi, 'h')
    .replace(/\[[^\]]*\]/g, '')
    .toLowerCase();
  const tokens = stripped.match(/[a-z]+/g) ?? [];
  let hasDate = false;
  let hasTime = false;
  tokens.forEach((token, index) => {
    if (/[yd]/.test(token)) hasDate = true;
    else if (/[hs]/.test(token)) hasTime = true;
    else if (/^m+$/.test(token)) {
      if (token.length >= 3) hasDate = true;
      else if (/^h/.test(tokens[index - 1] ?? '') || /^s/.test(tokens[index + 1] ?? '')) hasTime = true;
      else hasDate = true;
    }
  });
  if (hasDate) return 'date';
  return hasTime ? 'time' : undefined;
}

const MS_PER_DAY = 86400000;
/** Serials past these (9999-12-31) are outside what a spreadsheet can hold as a date. */
const END_1900 = 2958466;
const END_1904 = 2957004;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Year, month and day of a count of days since 1970-01-01 (Howard Hinnant's civil-from-days). */
function civilFromDays(days: number): [number, number, number] {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return [year, month, day];
}

function timeOfDay(msOfDay: number): string {
  const hours = Math.floor(msOfDay / 3600000);
  const minutes = Math.floor((msOfDay % 3600000) / 60000);
  const seconds = Math.floor((msOfDay % 60000) / 1000);
  const millis = msOfDay % 1000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${millis === 0 ? '' : `.${pad(millis, 3)}`}`;
}

/**
 * The ISO text of a serial, or null when the text is not a number or lies outside the dates a spreadsheet can hold.
 * 1900 system: serial 1 is 1900-01-01, serial 60 is the compatibility day 1900-02-29 (Excel counts 1900 as a leap year),
 * and from 61 the day is 1899-12-30 plus the serial. 1904 system: serial 0 is 1904-01-01. A whole number is a date
 * (`YYYY-MM-DD`), a fraction adds the time (`YYYY-MM-DDTHH:MM:SS`), and a value below 1 is a time of day (`HH:MM:SS`);
 * `timeOnly` says the cell's format shows only a time, so a value of exactly 0 is midnight and not a date.
 */
export function tryDate(serial: string, date1904: boolean, timeOnly = false): string | null {
  const text = serial.trim();
  if (text === '' || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value >= (date1904 ? END_1904 : END_1900)) return null;

  const totalMs = Math.round(value * MS_PER_DAY);
  const day = Math.floor(totalMs / MS_PER_DAY);
  const msOfDay = totalMs - day * MS_PER_DAY;

  if (day === 0 && (msOfDay > 0 || timeOnly)) return timeOfDay(msOfDay);

  let date: string;
  if (date1904) {
    const [y, m, d] = civilFromDays(day - 24107);
    date = `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
  } else if (day === 0) {
    date = '1900-01-00';
  } else if (day === 60) {
    date = '1900-02-29';
  } else {
    const [y, m, d] = civilFromDays(day - (day < 60 ? 25568 : 25569));
    date = `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
  }
  return msOfDay === 0 && !timeOnly ? date : `${date}T${timeOfDay(msOfDay)}`;
}

/** `tryDate` for a caller that wants a refusal: a serial that is no number, or no date, throws. */
export function serialToIso(serial: string, date1904: boolean): string {
  const iso = tryDate(serial, date1904);
  if (iso === null) {
    throw new SpreadsheetConverterError(
      `"${serial}" is not a date serial: it must be a number from 0 to ${(date1904 ? END_1904 : END_1900) - 1}.`,
    );
  }
  return iso;
}
