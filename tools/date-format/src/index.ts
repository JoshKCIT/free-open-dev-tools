import meta from './meta.json';

export { meta };

/** Thrown for a moment this package cannot read or a pattern it cannot render, naming the offender. */
export class DateFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateFormatError';
  }
}

/**
 * A moment's calendar and clock fields resolved in one IANA zone, plus the
 * zone's own offset and names for that moment. Every formatter below reads
 * only from this struct -- neither formatter re-touches `Intl` itself, so
 * the same resolved wall clock feeds strftime, LDML and (separately) the
 * Intl column.
 */
export interface WallClock {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
  /** 0-59 (leap seconds are not representable; see meta limits). */
  second: number;
  millisecond: number;
  /** 0 Sunday .. 6 Saturday. */
  weekday: number;
  /** 1-366. */
  dayOfYear: number;
  /** Minutes east of UTC (positive east), e.g. +330 for +05:30. */
  offsetMinutes: number;
  /** e.g. "PDT". */
  shortZoneName: string;
  /** e.g. "Pacific Daylight Time". */
  longZoneName: string;
}

function pad2(n: number): string {
  return String(Math.trunc(Math.abs(n))).padStart(2, '0');
}

function pad3(n: number): string {
  return String(Math.trunc(Math.abs(n))).padStart(3, '0');
}

/** Parses "GMT", "GMT+5", "GMT-07:00" (the longOffset styles seen across engines) into minutes east of UTC. */
function parseGmtOffset(text: string): number {
  if (text === 'GMT') return 0;
  const m = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(text);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = Number(m[2]);
  const minutes = Number(m[3] ?? '0');
  return sign * (hours * 60 + minutes);
}

/**
 * Resolves a moment to its wall-clock fields in an IANA zone, via
 * `Intl.DateTimeFormat`'s own `formatToParts` -- a local copy of the
 * `formatToParts` approach `tools/unix-timestamp` already uses, ported
 * (never imported) per this phase's D-23.
 */
export function wallClock(instant: Date, zone: string): WallClock {
  if (Number.isNaN(instant.getTime())) throw new DateFormatError('That moment is not a valid date.');

  const fields = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string): string => fields.find((p) => p.type === type)?.value ?? '';

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hourRaw = Number(get('hour'));
  const hour = hourRaw === 24 ? 0 : hourRaw; // ICU has rendered a wall midnight as "24" on some engines historically.
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  const millisecond = instant.getUTCMilliseconds();

  // The day of the week and the day of the year are properties of the wall
  // clock's own calendar date, not of the instant's time -- computing them
  // by re-anchoring the resolved y/m/d as if it were UTC is exact and
  // avoids depending on any locale's weekday-name spelling.
  const anchor = Date.UTC(year, month - 1, day);
  const weekday = new Date(anchor).getUTCDay();
  const startOfYear = Date.UTC(year, 0, 1);
  const dayOfYear = Math.round((anchor - startOfYear) / 86400000) + 1;

  const offsetText =
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(instant)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const offsetMinutes = parseGmtOffset(offsetText);

  const shortZoneName =
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(instant)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  const longZoneName =
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'long' })
      .formatToParts(instant)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond,
    weekday,
    dayOfYear,
    offsetMinutes,
    shortZoneName,
    longZoneName,
  };
}

/**
 * Parses a moment. Requires an explicit `Z` or a numeric UTC offset: a bare
 * local time has no absolute meaning on its own, and this package's own
 * `zone` field chooses the DISPLAY zone, never the input's meaning, so a
 * bare local time is refused rather than silently read as UTC or as the
 * display zone.
 */
export function parseMoment(input: string): Date {
  const trimmed = input.trim();
  if (trimmed === '') throw new DateFormatError('Nothing to format.');
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    throw new DateFormatError(
      'The moment needs an explicit Z or UTC offset, such as 1996-07-10T15:08:56-07:00. A bare local time has no absolute meaning by itself.',
    );
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) throw new DateFormatError('That is not a date this parser recognises.');
  return new Date(ms);
}

const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const WEEKDAY_ABBR = WEEKDAY_FULL.map((w) => w.slice(0, 3));
const MONTH_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const MONTH_ABBR = MONTH_FULL.map((m) => m.slice(0, 3));

/** ISO 8601 week-based year and week number (Monday-first weeks, week 1 contains the first Thursday of January). */
function isoWeekOf(year: number, month: number, day: number): { year: number; week: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dayNumber + 3); // move to the Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { year: d.getUTCFullYear(), week };
}

/**
 * `%U`/`%W`-style week number: the day-of-year of the week's own first day
 * (Sunday for `%U`, Monday for `%W`) that falls on or before 1 January is
 * week 0; every seven days after that first occurrence starts the next week.
 */
function simpleWeekNumber(dayOfYear: number, jan1Weekday: number, startWeekday: 0 | 1): number {
  const firstWeekStartDoy = 1 + ((startWeekday - jan1Weekday + 7) % 7);
  if (dayOfYear < firstWeekStartDoy) return 0;
  return Math.floor((dayOfYear - firstWeekStartDoy) / 7) + 1;
}

/** Conversion letter to its POSIX/C-locale rendering. Exported so a caller can enumerate what is supported. */
export const STRFTIME_CONVERSIONS: Record<string, (wall: WallClock) => string> = {
  a: (w) => WEEKDAY_ABBR[w.weekday]!,
  A: (w) => WEEKDAY_FULL[w.weekday]!,
  b: (w) => MONTH_ABBR[w.month - 1]!,
  B: (w) => MONTH_FULL[w.month - 1]!,
  h: (w) => MONTH_ABBR[w.month - 1]!,
  c: (w) => {
    const eDay = w.day < 10 ? ` ${w.day}` : String(w.day);
    return `${WEEKDAY_ABBR[w.weekday]} ${MONTH_ABBR[w.month - 1]} ${eDay} ${pad2(w.hour)}:${pad2(w.minute)}:${pad2(w.second)} ${w.year}`;
  },
  C: (w) => String(Math.trunc(w.year / 100)).padStart(2, '0'),
  d: (w) => pad2(w.day),
  D: (w) => `${pad2(w.month)}/${pad2(w.day)}/${pad2(w.year % 100)}`,
  e: (w) => (w.day < 10 ? ` ${w.day}` : String(w.day)),
  F: (w) => `${String(w.year).padStart(4, '0')}-${pad2(w.month)}-${pad2(w.day)}`,
  g: (w) => pad2(isoWeekOf(w.year, w.month, w.day).year % 100),
  G: (w) => String(isoWeekOf(w.year, w.month, w.day).year),
  H: (w) => pad2(w.hour),
  I: (w) => pad2(w.hour % 12 === 0 ? 12 : w.hour % 12),
  j: (w) => pad3(w.dayOfYear),
  m: (w) => pad2(w.month),
  M: (w) => pad2(w.minute),
  n: () => '\n',
  p: (w) => (w.hour < 12 ? 'AM' : 'PM'),
  r: (w) => {
    const h12 = w.hour % 12 === 0 ? 12 : w.hour % 12;
    return `${pad2(h12)}:${pad2(w.minute)}:${pad2(w.second)} ${w.hour < 12 ? 'AM' : 'PM'}`;
  },
  R: (w) => `${pad2(w.hour)}:${pad2(w.minute)}`,
  S: (w) => pad2(w.second),
  t: () => '\t',
  T: (w) => `${pad2(w.hour)}:${pad2(w.minute)}:${pad2(w.second)}`,
  u: (w) => String(w.weekday === 0 ? 7 : w.weekday),
  U: (w) => {
    const jan1Weekday = new Date(Date.UTC(w.year, 0, 1)).getUTCDay();
    return pad2(simpleWeekNumber(w.dayOfYear, jan1Weekday, 0));
  },
  V: (w) => pad2(isoWeekOf(w.year, w.month, w.day).week),
  w: (w) => String(w.weekday),
  W: (w) => {
    const jan1Weekday = new Date(Date.UTC(w.year, 0, 1)).getUTCDay();
    return pad2(simpleWeekNumber(w.dayOfYear, jan1Weekday, 1));
  },
  x: (w) => `${pad2(w.month)}/${pad2(w.day)}/${pad2(w.year % 100)}`,
  X: (w) => `${pad2(w.hour)}:${pad2(w.minute)}:${pad2(w.second)}`,
  y: (w) => pad2(((w.year % 100) + 100) % 100),
  Y: (w) => String(w.year),
  z: (w) => {
    const sign = w.offsetMinutes < 0 ? '-' : '+';
    const abs = Math.abs(w.offsetMinutes);
    return `${sign}${pad2(Math.floor(abs / 60))}${pad2(abs % 60)}`;
  },
  Z: (w) => w.shortZoneName,
  '%': () => '%',
};

/**
 * Renders a POSIX.1-2017 (C-locale) strftime pattern against an already
 * resolved wall clock. `E` and `O` modifiers are accepted and treated as a
 * no-op (the C/POSIX locale has no alternative representation to switch
 * to); a flag or a field width before a conversion letter -- both POSIX
 * extensions this package does not implement -- is rejected by name, as is
 * any conversion letter outside `STRFTIME_CONVERSIONS`.
 */
export function formatStrftime(pattern: string, wall: WallClock): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch !== '%') {
      out += ch;
      continue;
    }
    i++;
    if (i >= pattern.length) {
      throw new DateFormatError('A "%" at the end of the pattern has no conversion specifier after it.');
    }
    let c = pattern[i]!;
    if (c === 'E' || c === 'O') {
      const modifier = c;
      i++;
      if (i >= pattern.length) {
        throw new DateFormatError(`"%${modifier}" has no conversion specifier after it.`);
      }
      c = pattern[i]!;
    } else if (/[0-9+]/.test(c)) {
      let j = i;
      while (j < pattern.length && /[0-9+]/.test(pattern[j]!)) j++;
      throw new DateFormatError(
        `The flag or field width in "%${pattern.slice(i, j + 1)}" is not supported by this tool.`,
      );
    }
    const fn = STRFTIME_CONVERSIONS[c];
    if (!fn) throw new DateFormatError(`"%${c}" is not a supported strftime conversion.`);
    out += fn(wall);
  }
  return out;
}

export interface IntlFormatOptions {
  locale: string;
  zone: string;
  /** 'none' omits the date entirely, matching a bare time-only Intl call. */
  dateStyle?: 'full' | 'long' | 'medium' | 'short' | 'none';
  /** 'none' omits the time entirely. Both 'none' renders the locale's own bare default. */
  timeStyle?: 'full' | 'long' | 'medium' | 'short' | 'none';
}

/** Renders a moment with `Intl.DateTimeFormat` directly -- the browser's own answer, shown alongside the hand-written columns. */
export function formatIntl(instant: Date, options: IntlFormatOptions): string {
  if (Number.isNaN(instant.getTime())) throw new DateFormatError('That moment is not a valid date.');
  const opts: Intl.DateTimeFormatOptions = { timeZone: options.zone };
  if (options.dateStyle && options.dateStyle !== 'none') opts.dateStyle = options.dateStyle;
  if (options.timeStyle && options.timeStyle !== 'none') opts.timeStyle = options.timeStyle;
  return new Intl.DateTimeFormat(options.locale, opts).format(instant);
}
