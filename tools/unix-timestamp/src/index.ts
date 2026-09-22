import meta from './meta.json';

export { meta };

export type TimeUnit = 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds';

export interface UnitGuess {
  unit: TimeUnit;
  /** Why this unit was chosen, in words, so the guess can be overridden knowingly. */
  reason: string;
  /** False when the value is so far outside a plausible range that no guess is safe. */
  confident: boolean;
}

/**
 * Guesses which unit a bare number is in.
 *
 * Magnitude is the only signal available. The boundaries are chosen so that
 * any moment between 1973 and 5138 reads as seconds, and the same range in
 * milliseconds reads as milliseconds, which covers every timestamp anyone is
 * realistically pasting in.
 */
export function detectUnit(value: number): UnitGuess {
  const abs = Math.abs(value);
  if (abs === 0) return { unit: 'seconds', reason: 'Zero is the Unix epoch itself in any unit.', confident: true };
  if (abs < 1e11) {
    return {
      unit: 'seconds',
      reason: 'Fewer than 11 digits, which as seconds lands between 1970 and the year 5138.',
      confident: abs > 1e8,
    };
  }
  if (abs < 1e14) {
    return {
      unit: 'milliseconds',
      reason: 'Between 11 and 14 digits, the range JavaScript Date uses.',
      confident: true,
    };
  }
  if (abs < 1e17) {
    return {
      unit: 'microseconds',
      reason: 'Between 14 and 17 digits, which databases and tracing systems use.',
      confident: true,
    };
  }
  return {
    unit: 'nanoseconds',
    reason: '17 digits or more, the range Go and many tracing systems use.',
    confident: true,
  };
}

const DIVISOR: Record<TimeUnit, number> = {
  seconds: 1,
  milliseconds: 1e3,
  microseconds: 1e6,
  nanoseconds: 1e9,
};

/** Converts a value in the given unit to milliseconds since the epoch. */
export function toMilliseconds(value: number, unit: TimeUnit): number {
  return (value / DIVISOR[unit]) * 1000;
}

export function fromMilliseconds(ms: number, unit: TimeUnit): number {
  return (ms / 1000) * DIVISOR[unit];
}

export interface Rendered {
  iso: string;
  isoLocal: string;
  rfc7231: string;
  dateOnly: string;
  timeOnly: string;
  /** Formatted in the selected IANA time zone. */
  inZone: string;
  zoneOffset: string;
  zoneAbbreviation: string;
  relative: string;
  dayOfWeek: string;
  dayOfYear: number;
  isoWeek: string;
  quarter: number;
  isLeapYear: boolean;
  epochSeconds: number;
  epochMilliseconds: number;
  epochMicroseconds: number;
  epochNanoseconds: string;
}

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, '0');
}

/** ISO 8601 week date, which starts weeks on Monday and belongs to the year containing the Thursday. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dayNumber + 3); // move to the Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { year: d.getUTCFullYear(), week };
}

export function relativeTime(ms: number, now: number): string {
  const delta = ms - now;
  const abs = Math.abs(delta);
  const units: [number, string][] = [
    [31557600000, 'year'],
    [2629800000, 'month'],
    [604800000, 'week'],
    [86400000, 'day'],
    [3600000, 'hour'],
    [60000, 'minute'],
    [1000, 'second'],
  ];
  if (abs < 1000) return 'now';
  for (const [size, name] of units) {
    if (abs >= size) {
      const n = Math.round(abs / size);
      const plural = n === 1 ? name : `${name}s`;
      return delta > 0 ? `in ${n} ${plural}` : `${n} ${plural} ago`;
    }
  }
  return 'now';
}

function zoneParts(date: Date, timeZone: string): { formatted: string; offset: string; abbreviation: string } {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const offsetRaw = get('timeZoneName');

  const abbreviation =
    new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';

  // Normalise "GMT+5:30" and "GMT" into +05:30 and +00:00.
  let offset = '+00:00';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(offsetRaw);
  if (m) offset = `${m[1]}${pad(Number(m[2]))}:${m[3] ?? '00'}`;

  const formatted = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
  return { formatted, offset, abbreviation };
}

export interface RenderOptions {
  timeZone?: string;
  now?: number;
}

export function render(ms: number, options: RenderOptions = {}): Rendered {
  const { timeZone = 'UTC', now = Date.now() } = options;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw new RangeError('That value is outside the range a date can represent.');

  const zone = zoneParts(date, timeZone);
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = isoWeek(date);
  const year = date.getUTCFullYear();

  return {
    iso: date.toISOString(),
    isoLocal: `${zone.formatted.replace(' ', 'T')}${zone.offset}`,
    rfc7231: date.toUTCString(),
    dateOnly: date.toISOString().slice(0, 10),
    timeOnly: date.toISOString().slice(11, 19),
    inZone: zone.formatted,
    zoneOffset: zone.offset,
    zoneAbbreviation: zone.abbreviation,
    relative: relativeTime(ms, now),
    dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()]!,
    dayOfYear: Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - startOfYear) / 86400000) + 1,
    isoWeek: `${week.year}-W${pad(week.week)}`,
    quarter: Math.floor(date.getUTCMonth() / 3) + 1,
    isLeapYear: (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0,
    epochSeconds: Math.floor(ms / 1000),
    epochMilliseconds: ms,
    epochMicroseconds: ms * 1000,
    epochNanoseconds: (BigInt(Math.trunc(ms)) * 1000000n).toString(),
  };
}

export interface ParsedInput {
  ok: boolean;
  ms?: number;
  /** How the input was understood, shown so a wrong guess is obvious. */
  interpretation: string;
  detectedUnit?: TimeUnit;
  confident: boolean;
  error?: string;
}

/**
 * Accepts a bare number in any unit, or a date string.
 *
 * A date string with no time zone is read as UTC, not as local time. Reading
 * it as local is what most tools do and is the source of the off-by-some-hours
 * bug that follows a timestamp around for the rest of its life.
 */
export function parseInput(input: string, forcedUnit?: TimeUnit): ParsedInput {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, interpretation: '', confident: false, error: 'Nothing to convert.' };

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const value = Number(trimmed);
    const guess = forcedUnit ? { unit: forcedUnit, reason: 'Unit chosen by you.', confident: true } : detectUnit(value);
    const ms = toMilliseconds(value, guess.unit);
    if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) {
      return {
        ok: false,
        interpretation: `${value} read as ${guess.unit}`,
        confident: false,
        error: 'That lands outside the range a date can represent, which is about 275,760 years either side of 1970.',
      };
    }
    return {
      ok: true,
      ms,
      detectedUnit: guess.unit,
      confident: guess.confident,
      interpretation: `${value} read as ${guess.unit}. ${guess.reason}`,
    };
  }

  // Bare date or date-time with no zone: read as UTC, and say so.
  const bareDate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const bareDateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed);
  const candidate = bareDate || bareDateTime ? `${trimmed.replace(' ', 'T')}${bareDate ? 'T00:00:00' : ''}Z` : trimmed;

  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed)) {
    return {
      ok: false,
      interpretation: '',
      confident: false,
      error: 'Not a number and not a date this parser recognises. Try an ISO 8601 form such as 2026-01-15T12:30:00Z.',
    };
  }
  return {
    ok: true,
    ms: parsed,
    confident: true,
    interpretation:
      bareDate || bareDateTime
        ? 'Date text with no time zone, read as UTC. Add a Z or an offset to be explicit.'
        : 'Date text, parsed with its stated time zone.',
  };
}

/** The IANA zones worth offering by default. Any IANA name is accepted. */
export const COMMON_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Moscow',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
