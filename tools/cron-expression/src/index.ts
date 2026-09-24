import meta from './meta.json';

export { meta };

/**
 * Only "unix" is implemented so far. The Quartz dialect (six or seven
 * fields, seconds, optional year, ?, L, W, #) arrives in a later task of
 * this same plan; `DIALECTS` grows to include it then.
 */
export type Dialect = 'unix';

export const DIALECTS: readonly Dialect[] = ['unix'];

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
}

export interface ParsedCron {
  dialect: Dialect;
  expression: string;
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
  /** Unix only: crontab(5)'s literal "does the field's text contain *" test for each day field. */
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

export function parseCron(expression: string, dialect: Dialect): ParsedCron {
  if (!DIALECTS.includes(dialect)) {
    throw new CronError(`"${dialect}" is not a dialect this tool supports.`);
  }
  const trimmed = expression.trim();
  if (trimmed === '') {
    throw new CronError('A cron expression is required.', 0);
  }
  return parseUnix(trimmed);
}

// ----------------------------------------------------------------- next runs

export interface NextRunsResult {
  runs: Date[];
  /** Set when the search horizon was exhausted before finding `count` runs. */
  neverMessage?: string;
}

/** A full Gregorian cycle: long enough that exhausting it is real evidence the expression never fires. */
const UNIX_HORIZON_YEARS = 400;

/**
 * crontab(5): "Note: The day of a command's execution can be specified in
 * the following two fields — 'day of month', and 'day of week'. If both
 * fields are restricted (i.e., do not contain the "*" character), the
 * command will be run when either field matches the current time." When
 * only one (or neither) is restricted, both fields must match, which for an
 * unrestricted "*" field is always true, and so reduces to just the other
 * field's own condition.
 */
function dayMatches(parsed: ParsedCron, y: number, m: number, d: number): boolean {
  const domMatches = parsed.dayOfMonth.values.has(d);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const dowMatches = parsed.dayOfWeek.values.has(weekday);
  if (parsed.domRestricted && parsed.dowRestricted) {
    return domMatches || dowMatches;
  }
  return domMatches && dowMatches;
}

/**
 * Every instant strictly after `fromUtc` that `parsed` matches, up to
 * `count` (clamped to 1-50) of them, scanning day by day (skipping days
 * whose month/day-of-month/day-of-week do not match) and then the hour and
 * minute sets in order. Returns fewer than `count` runs plus `neverMessage`
 * when the search horizon is exhausted first — for example, a day-of-month
 * of 30 combined with February can never occur on the real calendar, so
 * the day-by-day scan never lands on it no matter how far it runs.
 */
export function nextRuns(parsed: ParsedCron, fromUtc: Date, count: number): NextRunsResult {
  const n = Math.max(1, Math.min(50, Math.floor(count) || 1));
  const startMs = fromUtc.getTime();
  const runs: Date[] = [];

  const startY = fromUtc.getUTCFullYear();
  const startM = fromUtc.getUTCMonth();
  const startD = fromUtc.getUTCDate();
  let cursorMs = Date.UTC(startY, startM, startD);
  const horizonMs = Date.UTC(startY + UNIX_HORIZON_YEARS, startM, startD);

  const sortedHours = [...parsed.hour.values].sort((a, b) => a - b);
  const sortedMinutes = [...parsed.minute.values].sort((a, b) => a - b);

  while (cursorMs <= horizonMs && runs.length < n) {
    const cursor = new Date(cursorMs);
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth() + 1;
    const d = cursor.getUTCDate();

    if (parsed.month.values.has(m) && dayMatches(parsed, y, m, d)) {
      outer: for (const h of sortedHours) {
        for (const mi of sortedMinutes) {
          const runMs = Date.UTC(y, m - 1, d, h, mi, 0);
          if (runMs > startMs) {
            runs.push(new Date(runMs));
            if (runs.length >= n) break outer;
          }
        }
      }
    }
    cursorMs += 86_400_000;
  }

  if (runs.length < n) {
    return {
      runs,
      neverMessage: `No run was found within the search horizon (${UNIX_HORIZON_YEARS} years). This can mean the expression describes a date that never occurs, such as February 30.`,
    };
  }
  return { runs };
}
