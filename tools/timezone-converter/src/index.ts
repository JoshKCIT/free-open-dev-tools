import meta from './meta.json';

export { meta };

/**
 * `pad`, `zoneParts`, `isValidZone` and `COMMON_ZONES` below are a second,
 * independent copy of an existing pattern this project already ships
 * elsewhere -- never imported, per this project's own rule against a tool
 * package depending on anything outside its own folder.
 */

export class TimeZoneError extends Error {
  /** Index into the input where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'TimeZoneError';
    this.position = position;
  }
}

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, '0');
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
  'Australia/Lord_Howe',
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

/** A zone's reading of a specific instant: its local wall clock, UTC offset and abbreviation. */
export interface ZoneReading {
  /** `YYYY-MM-DD HH:MM:SS`, the zone's own local wall clock at that instant. */
  wall: string;
  /** `+HH:MM` or `-HH:MM`. */
  offset: string;
  abbreviation: string;
}

/**
 * The zone's reading of `date`: local wall clock, UTC offset and
 * abbreviation, built entirely from the platform's own `Intl.DateTimeFormat`
 * (no bundled tz database, per D-30).
 */
export function zoneParts(date: Date, timeZone: string): ZoneReading {
  // 'longOffset', not 'shortOffset': shortOffset is inconsistent across
  // engines -- Firefox returns a named abbreviation ("BST") instead of a
  // numeric offset for some zone/locale combinations, which silently broke
  // offset parsing below. longOffset always gives "GMT+HH:MM" (or a bare
  // "GMT" for a true zero offset in WebKit), verified this session directly
  // in chromium, firefox and webkit for every zone this tool tests.
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const offsetRaw = get('timeZoneName');

  // en-US, not en-GB: CLDR's short zone-name table is locale-specific and
  // incomplete per locale (en-GB knows "BST" for London but only reports a
  // bare "GMT-4" offset for New York; en-US knows "EDT"/"EST" for New York).
  // en-US is the broader-coverage choice for the named US abbreviations
  // this tool's own RFC 5545 test vectors depend on.
  const abbreviation =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';

  // Normalise "GMT+5:30" and "GMT" into +05:30 and +00:00.
  let offset = '+00:00';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(offsetRaw);
  if (m) offset = `${m[1]}${pad(Number(m[2]))}:${m[3] ?? '00'}`;

  const wall = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
  return { wall, offset, abbreviation };
}

/** `offset` such as "+05:30" or "-04:00", as minutes east of UTC. */
function offsetToMinutes(offset: string): number {
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hh, mm] = offset.slice(1).split(':').map(Number);
  return sign * (hh! * 60 + mm!);
}

/** The zone's UTC offset at `instantMs`, in minutes east of UTC, read via `zoneParts`. */
function offsetAt(instantMs: number, zone: string): number {
  return offsetToMinutes(zoneParts(new Date(instantMs), zone).offset);
}

function formatWall(y: number, mo: number, d: number, h: number, mi: number, s: number): string {
  return `${String(y).padStart(4, '0')}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
}

const DAY_MS = 86400000;

const MOMENT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/;

export interface Conversion {
  /** The resolved instant, as an ISO 8601 UTC string. */
  instantUtc: string;
  from: ZoneReading;
  to: ZoneReading;
  /** Explains a gap or overlap resolution. Absent for an ordinary, unambiguous moment. */
  note?: string;
  /** The second reading of a fall-back overlap, when the typed local time happened twice. */
  alternative?: ZoneReading & { instantUtc: string };
}

/**
 * Converts `input` from `fromZone` to `toZone`.
 *
 * `input` is `YYYY-MM-DDTHH:MM` optionally with `:SS` and a trailing `Z` or
 * `±HH:MM` offset. With an offset, that stated offset wins and `fromZone` is
 * ignored for interpreting the moment (it is still used to render the `from`
 * reading). Without one, `input` is read as a wall-clock time in `fromZone`,
 * resolved by trying the offset in force a day before and a day after the
 * nominal instant and keeping whichever candidate(s) round-trip back to the
 * typed wall clock: two round-tripping candidates is a fall-back overlap
 * (both returned, the earlier -- the offset before the change -- chosen as
 * the primary result); none round-tripping is a spring-forward gap, resolved
 * with the offset in force just before the gap per RFC 5545 section 3.3.5.
 */
export function convertMoment(input: string, fromZone: string, toZone: string): Conversion {
  const trimmed = input.trim();
  const match = MOMENT_RE.exec(trimmed);
  if (!match) {
    throw new TimeZoneError(
      `"${input}" is not a moment in the form YYYY-MM-DDTHH:MM, optionally with :SS and a trailing Z or ±HH:MM offset.`,
    );
  }
  if (!isValidZone(fromZone)) {
    throw new TimeZoneError(`"${fromZone}" is not an IANA time zone name your browser knows.`);
  }
  if (!isValidZone(toZone)) {
    throw new TimeZoneError(`"${toZone}" is not an IANA time zone name your browser knows.`);
  }

  const [, yStr, moStr, dStr, hStr, miStr, sStr, offsetPart] = match;
  const y = Number(yStr);
  const mo = Number(moStr);
  const d = Number(dStr);
  const h = Number(hStr);
  const mi = Number(miStr);
  const s = sStr ? Number(sStr) : 0;

  let instantMs: number;
  let note: string | undefined;
  let alternative: Conversion['alternative'];

  if (offsetPart) {
    // The stated offset (or Z) wins; fromZone is not consulted to interpret the moment.
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
      throw new TimeZoneError(`"${input}" is not a moment this parser recognises.`);
    }
    instantMs = parsed;
  } else {
    const nominal = Date.UTC(y, mo - 1, d, h, mi, s);
    const nominalWall = formatWall(y, mo, d, h, mi, s);
    const offsetBefore = offsetAt(nominal - DAY_MS, fromZone);
    const offsetAfter = offsetAt(nominal + DAY_MS, fromZone);
    const t1 = nominal - offsetBefore * 60000;
    const t2 = nominal - offsetAfter * 60000;
    const valid1 = zoneParts(new Date(t1), fromZone).wall === nominalWall;
    const valid2 = zoneParts(new Date(t2), fromZone).wall === nominalWall;

    if (valid1 && valid2 && t1 !== t2) {
      // Fall-back overlap: both candidates round-trip to the same typed wall
      // clock. t1 (built from the pre-transition offset) is chronologically
      // earlier, so it is the first occurrence -- RFC 5545 section 3.3.5's
      // own choice of primary reading.
      instantMs = t1;
      const second = zoneParts(new Date(t2), fromZone);
      alternative = { ...second, instantUtc: new Date(t2).toISOString() };
      note = `${nominalWall} in ${fromZone} happens twice, because clocks are set back through it. Showing the first occurrence; the second reading is also below.`;
    } else if (!valid1 && !valid2) {
      // Spring-forward gap: neither candidate round-trips, because the typed
      // wall clock never occurs. RFC 5545 section 3.3.5: read using the
      // offset in force just before the gap, which is t1.
      instantMs = t1;
      note = `${nominalWall} does not exist in ${fromZone}, because clocks skip forward past it. Read using the offset in force just before the gap (RFC 5545 section 3.3.5).`;
    } else {
      // Ordinary case (t1 === t2, both valid) or exactly one candidate
      // round-trips: use whichever one is valid.
      instantMs = valid1 ? t1 : t2;
    }
  }

  return {
    instantUtc: new Date(instantMs).toISOString(),
    from: zoneParts(new Date(instantMs), fromZone),
    to: zoneParts(new Date(instantMs), toZone),
    note,
    alternative,
  };
}

export interface Transition {
  /** The instant the offset changes, as an ISO 8601 UTC string. */
  atUtc: string;
  offsetBefore: string;
  offsetAfter: string;
  /** The zone's local wall clock in the instant just before the change. */
  wallBefore: string;
  /** The zone's local wall clock at (or just after) the change. */
  wallAfter: string;
}

function daysInYear(year: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return leap ? 366 : 365;
}

/**
 * Every UTC-offset change `zone` makes during `year`, found by sampling the
 * offset at 00:00 UTC on each day of the year and binary-searching every day
 * where it differs from the previous day down to the exact millisecond the
 * change takes effect (finer than the day-level sampling needs, so the
 * reported instant lines up exactly with the published transition time
 * rather than landing up to a second late).
 */
export function findTransitions(zone: string, year: number): Transition[] {
  if (!isValidZone(zone)) {
    throw new TimeZoneError(`"${zone}" is not an IANA time zone name your browser knows.`);
  }

  const days = daysInYear(year);
  const transitions: Transition[] = [];
  let prevMs = Date.UTC(year, 0, 1);
  let prevOffset = offsetAt(prevMs, zone);

  for (let i = 1; i < days; i++) {
    const curMs = Date.UTC(year, 0, 1 + i);
    const curOffset = offsetAt(curMs, zone);
    if (curOffset !== prevOffset) {
      let lo = prevMs;
      let hi = curMs;
      const loOffset = prevOffset;
      while (hi - lo > 1) {
        const mid = lo + Math.floor((hi - lo) / 2);
        if (offsetAt(mid, zone) === loOffset) lo = mid;
        else hi = mid;
      }
      transitions.push({
        atUtc: new Date(hi).toISOString(),
        offsetBefore: zoneParts(new Date(lo), zone).offset,
        offsetAfter: zoneParts(new Date(hi), zone).offset,
        wallBefore: zoneParts(new Date(lo), zone).wall,
        wallAfter: zoneParts(new Date(hi), zone).wall,
      });
    }
    prevMs = curMs;
    prevOffset = curOffset;
  }

  return transitions;
}
