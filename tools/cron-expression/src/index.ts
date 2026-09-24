import meta from './meta.json';

export { meta };

export type Dialect = 'unix' | 'quartz';

export const DIALECTS: readonly Dialect[] = ['unix', 'quartz'];

/**
 * Quartz-only special forms for a day field, evaluated against a specific
 * calendar day during the next-runs scan rather than expanded into a fixed
 * value set up front (their meaning depends on the month they land in).
 */
export type DaySpecial =
  | { kind: 'last' } // day-of-month L: the last day of the month
  | { kind: 'lastOffset'; offset: number } // day-of-month L-n
  | { kind: 'lastWeekday' } // day-of-month LW: the last weekday (Mon-Fri) of the month
  | { kind: 'nearestWeekday'; day: number } // day-of-month nW
  | { kind: 'lastDow'; weekday: number } // day-of-week nL: the last such weekday of the month (weekday normalised 0-6, 0=Sunday)
  | { kind: 'nthDow'; weekday: number; nth: number }; // day-of-week n#k

export interface CronField {
  /** Every concrete value this field matches, expanded from lists/ranges/steps/names. */
  values: Set<number>;
  /**
   * Whether the field's own SOURCE TEXT contains a literal "*" character.
   * This is crontab(5)'s own test for whether a day field is "restricted"
   * ("do not contain the * character") — a textual test, not a test of
   * whether the resulting value set happens to be the field's full range.
   * A field written as "*\/2" contains "*" and so is NOT restricted, even
   * though its values are only half the field's range.
   */
  hasStar: boolean;
  /** Quartz only: this field was written as "?" (no specific value). */
  isQuestion?: boolean;
  /** Quartz only: a day-field special form (L, L-n, LW, nW, nL, n#k). */
  special?: DaySpecial;
}

export interface ParsedCron {
  dialect: Dialect;
  expression: string;
  /** Quartz only. */
  seconds?: CronField;
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
  /** Quartz only: absent means no year restriction (any year in the search range). */
  year?: CronField;
  /**
   * Unix: crontab(5)'s literal "does the field's text contain *" test.
   * Quartz: whether the field is NOT "?" (Quartz requires exactly one of
   * the two day fields to be "?", so exactly one of these is true).
   */
  domRestricted: boolean;
  dowRestricted: boolean;
}

export class CronError extends Error {
  /** Which field (0-indexed) the problem was found in, when that is meaningful. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'CronError';
    this.position = position;
  }
}

// --------------------------------------------------------------- field parsing

interface FieldSpec {
  min: number;
  max: number;
  /** Lower-cased three-letter name to numeric value, e.g. { jan: 1, ... }. */
  names?: Record<string, number>;
  /** A resolved value equal to this becomes 0 (Unix day-of-week: 7 is an alias for Sunday, 0). */
  aliasToZero?: number;
}

function resolveNamedOrNumber(token: string, spec: FieldSpec, fieldName: string, position: number): number {
  if (/^\d+$/.test(token)) return Number(token);
  const named = spec.names?.[token.toLowerCase()];
  if (named !== undefined) return named;
  throw new CronError(`"${token}" is not a recognised ${fieldName} value.`, position);
}

function parseFieldPart(part: string, spec: FieldSpec, values: Set<number>, fieldName: string, position: number): void {
  if (part === '') {
    throw new CronError(`The ${fieldName} field has an empty value between commas.`, position);
  }

  let base = part;
  let step: number | undefined;
  const slash = part.indexOf('/');
  if (slash !== -1) {
    base = part.slice(0, slash);
    const stepText = part.slice(slash + 1);
    if (!/^\d+$/.test(stepText) || Number(stepText) <= 0) {
      throw new CronError(`"${part}" has an invalid step value; a step must be a positive whole number.`, position);
    }
    step = Number(stepText);
  }

  let start: number;
  let end: number;
  if (base === '*') {
    start = spec.min;
    end = spec.max;
  } else if (base.includes('-')) {
    const dash = base.indexOf('-');
    const a = base.slice(0, dash);
    const b = base.slice(dash + 1);
    if (a === '' || b === '') {
      throw new CronError(`"${part}" is not a valid ${fieldName} range.`, position);
    }
    start = resolveNamedOrNumber(a, spec, fieldName, position);
    end = resolveNamedOrNumber(b, spec, fieldName, position);
    if (start > end) {
      throw new CronError(
        `"${base}" is a backwards ${fieldName} range: the first value must be less than or equal to the second.`,
        position,
      );
    }
  } else {
    const v = resolveNamedOrNumber(base, spec, fieldName, position);
    start = v;
    end = step !== undefined ? spec.max : v;
  }

  if (start < spec.min || end > spec.max) {
    throw new CronError(`"${part}" is outside the ${spec.min}-${spec.max} range for ${fieldName}.`, position);
  }

  const increment = step ?? 1;
  for (let v = start; v <= end; v += increment) {
    values.add(spec.aliasToZero !== undefined && v === spec.aliasToZero ? 0 : v);
  }
}

function parseField(raw: string, spec: FieldSpec, fieldName: string, position: number): CronField {
  const values = new Set<number>();
  const hasStar = raw.includes('*');
  for (const part of raw.split(',')) {
    parseFieldPart(part, spec, values, fieldName, position);
  }
  if (values.size === 0) {
    throw new CronError(`"${raw}" did not resolve to any ${fieldName} value.`, position);
  }
  return { values, hasStar };
}

// ------------------------------------------------------------------ Unix dialect

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const UNIX_DOW_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/**
 * crontab(5) EXTENSIONS section, cronie's own manual page, and cronie's own
 * src/entry.c (which additionally accepts "midnight" as a synonym for
 * "daily" — the manual page's own EXTENSIONS list omits @midnight in this
 * particular rendering, but the source code Vixie/cronie actually ships
 * implements it identically to @daily; both are included here).
 */
const UNIX_MACROS: Record<string, string> = {
  yearly: '0 0 1 1 *',
  annually: '0 0 1 1 *',
  monthly: '0 0 1 * *',
  weekly: '0 0 * * 0',
  daily: '0 0 * * *',
  midnight: '0 0 * * *',
  hourly: '0 * * * *',
};

function parseUnix(trimmed: string): ParsedCron {
  let text = trimmed;
  if (text.startsWith('@')) {
    const name = text.slice(1).toLowerCase();
    if (name === 'reboot') {
      throw new CronError(
        '"@reboot" runs once at system startup, not on a repeating schedule, so it has no next runs to list.',
        0,
      );
    }
    const expanded = UNIX_MACROS[name];
    if (!expanded) {
      throw new CronError(`"${text}" is not a crontab(5) macro this tool recognises.`, 0);
    }
    text = expanded;
  }

  const fields = text.split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    throw new CronError(
      `The Unix dialect expects 5 fields (minute hour day-of-month month day-of-week); "${trimmed}" has ${fields.length}.`,
      fields.length,
    );
  }

  // ?, L, W, # (Quartz-only), H (a Jenkins-style randomised-value
  // extension some other parsers add) and a tilde range (cronie's own
  // randomised-range extension)
  // are all rejected naturally below: none of them is "*", a digit, a
  // recognised three-letter name, or a valid range/step shape, so
  // resolveNamedOrNumber / parseFieldPart already throw a CronError naming
  // the exact offending text. A blanket character check here would be
  // WRONG — "WED", "THU" and "JUL" are legitimate names that themselves
  // contain the letters W, H and L.

  const minute = parseField(fields[0]!, { min: 0, max: 59 }, 'minute', 0);
  const hour = parseField(fields[1]!, { min: 0, max: 23 }, 'hour', 1);
  const dayOfMonth = parseField(fields[2]!, { min: 1, max: 31 }, 'day-of-month', 2);
  const month = parseField(fields[3]!, { min: 1, max: 12, names: MONTH_NAMES }, 'month', 3);
  const dayOfWeek = parseField(fields[4]!, { min: 0, max: 7, names: UNIX_DOW_NAMES, aliasToZero: 7 }, 'day-of-week', 4);

  return {
    dialect: 'unix',
    expression: trimmed,
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    domRestricted: !dayOfMonth.hasStar,
    dowRestricted: !dayOfWeek.hasStar,
  };
}

// ---------------------------------------------------------------- Quartz dialect

/**
 * Quartz numbers day-of-week 1-7 with 1 = Sunday (unlike Unix's 0-6/0-7).
 * Values are normalised to the same internal 0-6 (0 = Sunday) convention
 * Unix uses by subtracting 1 at the point they are resolved.
 */
const QUARTZ_DOW_NAMES: Record<string, number> = {
  sun: 1,
  mon: 2,
  tue: 3,
  wed: 4,
  thu: 5,
  fri: 6,
  sat: 7,
};

function resolveQuartzWeekday(token: string, position: number): number {
  if (/^\d$/.test(token)) {
    const n = Number(token);
    if (n < 1 || n > 7) {
      throw new CronError(`"${token}" is not a valid Quartz day-of-week (1-7, where 1 is Sunday).`, position);
    }
    return n - 1;
  }
  const named = QUARTZ_DOW_NAMES[token.toLowerCase()];
  if (named !== undefined) return named - 1;
  throw new CronError(`"${token}" is not a recognised Quartz day-of-week name.`, position);
}

/** Day-of-month field: plain values, or L, L-n, LW, nW. */
function parseQuartzDayOfMonth(text: string, position: number): CronField {
  if (text === 'L') return { values: new Set(), hasStar: false, special: { kind: 'last' } };
  if (text === 'LW') return { values: new Set(), hasStar: false, special: { kind: 'lastWeekday' } };

  let m = /^L-(\d{1,2})$/.exec(text);
  if (m) {
    const offset = Number(m[1]);
    if (offset < 0 || offset > 30) {
      throw new CronError(`"${text}" is out of range for day-of-month.`, position);
    }
    return { values: new Set(), hasStar: false, special: { kind: 'lastOffset', offset } };
  }

  m = /^(\d{1,2})W$/.exec(text);
  if (m) {
    const day = Number(m[1]);
    if (day < 1 || day > 31) {
      throw new CronError(`"${text}" is out of range for day-of-month.`, position);
    }
    return { values: new Set(), hasStar: false, special: { kind: 'nearestWeekday', day } };
  }

  return parseField(text, { min: 1, max: 31 }, 'day-of-month', position);
}

/** Day-of-week field: plain values (1-7 or SUN-SAT), or L, nL, n#k. */
function parseQuartzDayOfWeek(text: string, position: number): CronField {
  // Bare "L" in the day-of-week field is a PLAIN value: Quartz's own
  // javadoc says "If used in the day-of-week field by itself, it simply
  // means '7' or 'SAT'" -- every Saturday, not "the last Saturday".
  if (text === 'L') return { values: new Set([6]), hasStar: false };

  let m = /^(\d|[A-Za-z]{3})L$/.exec(text);
  if (m) {
    const weekday = resolveQuartzWeekday(m[1]!, position);
    return { values: new Set(), hasStar: false, special: { kind: 'lastDow', weekday } };
  }

  m = /^(\d|[A-Za-z]{3})#([1-5])$/.exec(text);
  if (m) {
    const weekday = resolveQuartzWeekday(m[1]!, position);
    const nth = Number(m[2]);
    return { values: new Set(), hasStar: false, special: { kind: 'nthDow', weekday, nth } };
  }

  const field = parseField(text, { min: 1, max: 7, names: QUARTZ_DOW_NAMES }, 'day-of-week', position);
  // Normalise Quartz's 1-7 (1 = Sunday) to the internal 0-6 (0 = Sunday)
  // convention shared with Unix and with JavaScript's own getUTCDay().
  return { values: new Set([...field.values].map((v) => v - 1)), hasStar: field.hasStar };
}

function parseQuartz(trimmed: string): ParsedCron {
  const fields = trimmed.split(/\s+/).filter(Boolean);
  if (fields.length !== 6 && fields.length !== 7) {
    throw new CronError(
      `The Quartz dialect expects 6 or 7 fields (second minute hour day-of-month month day-of-week [year]); "${trimmed}" has ${fields.length}.`,
      fields.length,
    );
  }

  const [secondText, minuteText, hourText, domText, monthText, dowText, yearText] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
    string | undefined,
  ];

  const seconds = parseField(secondText, { min: 0, max: 59 }, 'second', 0);
  const minute = parseField(minuteText, { min: 0, max: 59 }, 'minute', 1);
  const hour = parseField(hourText, { min: 0, max: 23 }, 'hour', 2);
  const month = parseField(monthText, { min: 1, max: 12, names: MONTH_NAMES }, 'month', 4);

  const domIsQuestion = domText === '?';
  const dowIsQuestion = dowText === '?';
  if (domIsQuestion === dowIsQuestion) {
    throw new CronError(
      'Quartz requires a question mark (?) in exactly one of day-of-month or day-of-week -- both restricted, or neither, is not supported.',
      domIsQuestion ? 5 : 3,
    );
  }

  const dayOfMonth: CronField = domIsQuestion
    ? { values: new Set(), hasStar: false, isQuestion: true }
    : parseQuartzDayOfMonth(domText, 3);
  const dayOfWeek: CronField = dowIsQuestion
    ? { values: new Set(), hasStar: false, isQuestion: true }
    : parseQuartzDayOfWeek(dowText, 5);

  const year = yearText !== undefined ? parseField(yearText, { min: 1970, max: 2099 }, 'year', 6) : undefined;

  return {
    dialect: 'quartz',
    expression: trimmed,
    seconds,
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    year,
    domRestricted: !domIsQuestion,
    dowRestricted: !dowIsQuestion,
  };
}

export function parseCron(expression: string, dialect: Dialect): ParsedCron {
  if (!DIALECTS.includes(dialect)) {
    throw new CronError(`"${dialect}" is not a dialect this tool supports.`);
  }
  const trimmed = expression.trim();
  if (trimmed === '') {
    throw new CronError('A cron expression is required.', 0);
  }
  return dialect === 'unix' ? parseUnix(trimmed) : parseQuartz(trimmed);
}

// ----------------------------------------------------------------- next runs

export interface NextRunsResult {
  runs: Date[];
  /** Set when the search horizon was exhausted before finding `count` runs. */
  neverMessage?: string;
}

/** A full Gregorian cycle: long enough that exhausting it is real evidence the expression never fires. */
const UNIX_HORIZON_YEARS = 400;

/** Quartz's own year field range (this tool's tutorial-sourced choice; see meta.json ambiguities). */
const QUARTZ_MAX_YEAR = 2099;

function utcWeekday(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The number of days in a given month (m: 1-12), leap years included. */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The last weekday (Monday-Friday) of the month, per Quartz's LW. */
function lastWeekdayOfMonth(y: number, m: number): number {
  const last = daysInMonth(y, m);
  const weekday = utcWeekday(y, m, last);
  if (weekday === 6) return last - 1; // Saturday -> Friday
  if (weekday === 0) return last - 2; // Sunday -> Friday
  return last;
}

/**
 * The weekday (Monday-Friday) nearest `day`, without crossing a month
 * boundary, per Quartz's nW. Ported from CronExpression.java's own
 * algorithm (fetched live this session): if `day` falls on a Saturday,
 * use the day before (or the Monday after, if `day` is the 1st, so as
 * never to "jump" into the previous month); if `day` falls on a Sunday,
 * use the day after (or the Friday before, if `day` is the month's last
 * day). Returns null when `day` does not exist in this month at all
 * (nW is only ever compared against a real day-of-month, so this simply
 * means the month has no match).
 */
function nearestWeekday(y: number, m: number, day: number): number | null {
  const last = daysInMonth(y, m);
  if (day > last) return null;
  const weekday = utcWeekday(y, m, day);
  if (weekday === 6) return day === 1 ? day + 2 : day - 1;
  if (weekday === 0) return day === last ? day - 2 : day + 1;
  return day;
}

function domSpecialMatches(field: CronField, y: number, m: number, d: number): boolean {
  const special = field.special;
  if (!special) return field.values.has(d);
  switch (special.kind) {
    case 'last':
      return d === daysInMonth(y, m);
    case 'lastOffset':
      return d === daysInMonth(y, m) - special.offset;
    case 'lastWeekday':
      return d === lastWeekdayOfMonth(y, m);
    case 'nearestWeekday':
      return d === nearestWeekday(y, m, special.day);
    default:
      return false;
  }
}

function dowSpecialMatches(field: CronField, y: number, m: number, d: number): boolean {
  const special = field.special;
  const weekday = utcWeekday(y, m, d);
  if (!special) return field.values.has(weekday);
  const last = daysInMonth(y, m);
  switch (special.kind) {
    case 'lastDow':
      return weekday === special.weekday && d + 7 > last;
    case 'nthDow':
      return weekday === special.weekday && Math.floor((d - 1) / 7) + 1 === special.nth;
    default:
      return false;
  }
}

/**
 * crontab(5): "Note: The day of a command's execution can be specified in
 * the following two fields — 'day of month', and 'day of week'. If both
 * fields are restricted (i.e., do not contain the "*" character), the
 * command will be run when either field matches the current time." When
 * only one (or neither) is restricted, both fields must match, which for an
 * unrestricted "*" field is always true, and so reduces to just the other
 * field's own condition.
 *
 * Quartz requires exactly one of day-of-month/day-of-week to be "?" (no
 * specific value), so there is no OR/AND ambiguity to resolve there: the
 * day matches exactly when the ONE restricted field's own condition holds.
 */
function dayMatches(parsed: ParsedCron, y: number, m: number, d: number): boolean {
  if (parsed.dialect === 'unix') {
    const domMatches = parsed.dayOfMonth.values.has(d);
    const dowMatches = parsed.dayOfWeek.values.has(utcWeekday(y, m, d));
    if (parsed.domRestricted && parsed.dowRestricted) {
      return domMatches || dowMatches;
    }
    return domMatches && dowMatches;
  }
  return parsed.dayOfMonth.isQuestion
    ? dowSpecialMatches(parsed.dayOfWeek, y, m, d)
    : domSpecialMatches(parsed.dayOfMonth, y, m, d);
}

/**
 * Every instant strictly after `fromUtc` that `parsed` matches, up to
 * `count` (clamped to 1-50) of them, scanning day by day (skipping days
 * whose month/year/day-of-month/day-of-week do not match) and then the
 * hour, minute and (Quartz only) second sets in order. Returns fewer than
 * `count` runs plus `neverMessage` when the search horizon is exhausted
 * first — for example, a day-of-month of 30 combined with February can
 * never occur on the real calendar, so the day-by-day scan never lands on
 * it no matter how far it runs.
 */
export function nextRuns(parsed: ParsedCron, fromUtc: Date, count: number): NextRunsResult {
  const n = Math.max(1, Math.min(50, Math.floor(count) || 1));
  const startMs = fromUtc.getTime();
  const runs: Date[] = [];

  const startY = fromUtc.getUTCFullYear();
  const startM = fromUtc.getUTCMonth();
  const startD = fromUtc.getUTCDate();
  let cursorMs = Date.UTC(startY, startM, startD);
  const horizonMs =
    parsed.dialect === 'unix'
      ? Date.UTC(startY + UNIX_HORIZON_YEARS, startM, startD)
      : Date.UTC(QUARTZ_MAX_YEAR + 1, 0, 1);

  const sortedHours = [...parsed.hour.values].sort((a, b) => a - b);
  const sortedMinutes = [...parsed.minute.values].sort((a, b) => a - b);
  const sortedSeconds = parsed.seconds ? [...parsed.seconds.values].sort((a, b) => a - b) : [0];

  while (cursorMs <= horizonMs && runs.length < n) {
    const cursor = new Date(cursorMs);
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth() + 1;
    const d = cursor.getUTCDate();

    const yearOk = !parsed.year || parsed.year.values.has(y);
    if (yearOk && parsed.month.values.has(m) && dayMatches(parsed, y, m, d)) {
      outer: for (const h of sortedHours) {
        for (const mi of sortedMinutes) {
          for (const s of sortedSeconds) {
            const runMs = Date.UTC(y, m - 1, d, h, mi, s);
            if (runMs > startMs) {
              runs.push(new Date(runMs));
              if (runs.length >= n) break outer;
            }
          }
        }
      }
    }
    cursorMs += 86_400_000;
  }

  if (runs.length < n) {
    const horizonText =
      parsed.dialect === 'unix' ? `${UNIX_HORIZON_YEARS} years` : `through the year ${QUARTZ_MAX_YEAR}`;
    return {
      runs,
      neverMessage: `No run was found within the search horizon (${horizonText}). This can mean the expression describes a date that never occurs, such as February 30, or a day-of-week occurrence (#) that does not exist every month.`,
    };
  }
  return { runs };
}
