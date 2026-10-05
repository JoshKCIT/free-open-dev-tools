import {
  meta,
  parseMoment,
  parseDuration,
  diffMoments,
  addDuration,
  formatIsoDuration,
  DateDiffError,
  CalendarDateError,
  IsoDurationError,
  MAX_DATE_LINES,
  MAX_HOLIDAY_LINES,
  buildIsoDuration,
  countBusinessDays,
  dayNumber,
  formatCalendarDate,
  isoWeekDate,
  parseCalendarDate,
  parseIsoDuration,
  parseWeekend,
  readDateLines,
  timePartSeconds,
  weekStartText,
  weeksInIsoYear,
  type IsoDuration,
} from '@fodt/date-diff';
import { defineTool, str, type OutputBlock, type ToolIssue, type ToolResult, type Values } from '../lib/tool-ui';

// --- The four newer modes: business days, ISO week numbers, reading and building ISO 8601 durations ---

const OLD_MODES = ['difference', 'add', 'subtract'];
const modeOf = (values: Values): string => str(values, 'mode', 'difference');
const modeIs =
  (...modes: string[]) =>
  (values: Values): boolean =>
    modes.includes(modeOf(values));

/** A pasted list is refused above this many characters: 5,000 dates of ten characters need a small fraction of it. */
const MAX_LIST_CHARACTERS = 200_000;
const MAX_SHOWN_PROBLEMS = 50;
const MAX_PART = 999_999;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const CALENDAR_UNITS_NOTE =
  'Years, months, weeks and days are calendar units: how long they last depends on the date they start from, so no total in seconds is given for them. Only the time part (hours, minutes and seconds) has an exact length.';

/** The first problems of a pasted list as line-numbered issues, and a sentence for the rest. */
function listIssues(
  label: string,
  problems: { line: number; message: string }[],
): { errors: ToolIssue[]; warnings: string[] } {
  const errors = problems.slice(0, MAX_SHOWN_PROBLEMS).map((problem) => ({
    message: `${label}: ${problem.message}`,
    line: problem.line,
  }));
  const warnings =
    problems.length > MAX_SHOWN_PROBLEMS
      ? [
          `${problems.length - MAX_SHOWN_PROBLEMS} more lines are not dates; the first ${MAX_SHOWN_PROBLEMS} are listed.`,
        ]
      : [];
  return { errors, warnings };
}

function runBusiness(values: Values): ToolResult {
  const startText = str(values, 'businessStart');
  const endText = str(values, 'end');
  if (!startText.trim() || !endText.trim()) return { outputs: [] };

  let start: number;
  let end: number;
  try {
    start = dayNumber(parseCalendarDate(startText));
  } catch (error) {
    if (error instanceof CalendarDateError) return { outputs: [], errors: [{ message: `Start: ${error.message}` }] };
    throw error;
  }
  try {
    end = dayNumber(parseCalendarDate(endText));
  } catch (error) {
    if (error instanceof CalendarDateError) return { outputs: [], errors: [{ message: `End: ${error.message}` }] };
    throw error;
  }

  let weekend: Set<number>;
  try {
    weekend = parseWeekend(str(values, 'weekend', 'Sat, Sun'));
  } catch (error) {
    if (error instanceof CalendarDateError) return { outputs: [], errors: [{ message: error.message }] };
    throw error;
  }

  let holidays: number[];
  try {
    const list = readDateLines(str(values, 'holidays'), MAX_HOLIDAY_LINES, MAX_LIST_CHARACTERS);
    if (list.problems.length > 0) {
      const { errors, warnings } = listIssues('Holidays', list.problems);
      return { outputs: [], errors, warnings };
    }
    holidays = list.dates.map((entry) => dayNumber(entry.date));
  } catch (error) {
    if (error instanceof CalendarDateError) return { outputs: [], errors: [{ message: `Holidays: ${error.message}` }] };
    throw error;
  }

  const includeEnd = str(values, 'endDay', 'excluded') === 'included';
  const result = countBusinessDays({ start, end, weekend, holidays, includeEnd });
  const outputs: OutputBlock[] = [
    {
      kind: 'keyvalue',
      label: 'Business days',
      pairs: [
        ['Business days', result.sign < 0 && result.count > 0 ? `-${result.count}` : String(result.count)],
        ['Calendar days', String(result.calendarDays)],
        ['Weekend days skipped', String(result.weekendDays)],
        ['Holidays skipped', String(result.holidaysSkipped)],
        ['Holidays on weekend days', String(result.holidaysOnWeekend)],
        ['End day', includeEnd ? 'Counted' : 'Not counted'],
      ],
    },
  ];
  if (result.sign < 0) {
    outputs.push({
      kind: 'note',
      tone: 'info',
      value:
        'The end is before the start, so the count has a minus sign. The start day is still counted: the days counted run from the day after the end (or the end itself when End day is Counted) up to and including the start.',
    });
  }
  return { outputs };
}

function runWeeks(values: Values): ToolResult {
  let list;
  try {
    list = readDateLines(str(values, 'dates'), MAX_DATE_LINES, MAX_LIST_CHARACTERS);
  } catch (error) {
    if (error instanceof CalendarDateError) return { outputs: [], errors: [{ message: `Dates: ${error.message}` }] };
    throw error;
  }
  if (list.dates.length === 0 && list.problems.length === 0) return { outputs: [] };

  const rows = list.dates.map((entry) => {
    const week = isoWeekDate(entry.date);
    return [
      entry.line,
      formatCalendarDate(entry.date),
      week.text,
      week.weekYear,
      week.week,
      `${week.weekday} ${WEEKDAY_NAMES[week.weekday - 1]}`,
      weekStartText(entry.date),
      weeksInIsoYear(week.weekYear),
    ];
  });
  const outputs: OutputBlock[] =
    rows.length > 0
      ? [
          {
            kind: 'table',
            label: 'ISO 8601 week dates',
            table: {
              headers: [
                'Line',
                'Date',
                'ISO week date',
                'Week-numbering year',
                'Week',
                'Weekday',
                'Week starts',
                'Weeks in that year',
              ],
              rows,
              mono: [0, 1, 2, 6],
            },
          },
        ]
      : [];
  const { errors, warnings } = listIssues('Dates', list.problems);
  return {
    outputs,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/** The canonical text, parts table and note shown for a duration read from text or built from fields. */
function durationOutputs(parts: IsoDuration): OutputBlock[] {
  return [
    { kind: 'code', label: 'ISO 8601 duration', value: buildIsoDuration(parts) },
    {
      kind: 'table',
      label: 'Parts',
      table: {
        headers: ['Part', 'Value'],
        rows: [
          ['Years', parts.years],
          ['Months', parts.months],
          ['Weeks', parts.weeks],
          ['Days', parts.days],
          ['Hours', parts.hours],
          ['Minutes', parts.minutes],
          ['Seconds', parts.seconds],
          ['Hours, minutes and seconds in seconds', timePartSeconds(parts)],
        ],
        mono: [1],
      },
    },
    { kind: 'note', tone: 'info', value: CALENDAR_UNITS_NOTE },
  ];
}

function runDuration(values: Values): ToolResult {
  const text = str(values, 'isoDuration');
  if (!text.trim()) return { outputs: [] };
  try {
    return { outputs: durationOutputs(parseIsoDuration(text)) };
  } catch (error) {
    if (error instanceof IsoDurationError) return { outputs: [], errors: [{ message: error.message }] };
    throw error;
  }
}

const BUILD_FIELDS: { name: 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes'; label: string }[] = [
  { name: 'years', label: 'Years' },
  { name: 'months', label: 'Months' },
  { name: 'weeks', label: 'Weeks' },
  { name: 'days', label: 'Days' },
  { name: 'hours', label: 'Hours' },
  { name: 'minutes', label: 'Minutes' },
];

function runBuild(values: Values): ToolResult {
  const parts: Partial<IsoDuration> = {};
  const errors: ToolIssue[] = [];
  for (const field of BUILD_FIELDS) {
    const raw = values[field.name];
    let value = 0;
    if (typeof raw === 'number') value = raw;
    else if (typeof raw === 'string' && raw.trim() !== '') value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > MAX_PART) {
      errors.push({ message: `${field.label} must be a whole number from 0 to 999,999.` });
    } else {
      parts[field.name] = String(value);
    }
  }
  if (errors.length > 0) return { outputs: [], errors };
  const seconds = str(values, 'seconds', '0').trim();
  try {
    const text = buildIsoDuration({ ...parts, seconds: seconds === '' ? '0' : seconds });
    return { outputs: durationOutputs(parseIsoDuration(text)) };
  } catch (error) {
    if (error instanceof IsoDurationError) {
      // A sentence that already names the part (the seconds text is the only free text here) is shown as it is.
      const named = error.message.startsWith('The seconds value ');
      return { outputs: [], errors: [{ message: named ? error.message : `Seconds: ${error.message}` }] };
    }
    throw error;
  }
}

export default defineTool({
  id: 'date-diff',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'difference',
      options: [
        { value: 'difference', label: 'Difference between two moments' },
        { value: 'add', label: 'Add a duration' },
        { value: 'subtract', label: 'Subtract a duration' },
        { value: 'business', label: 'Count business days' },
        { value: 'weeks', label: 'ISO week numbers' },
        { value: 'duration', label: 'Parse an ISO 8601 duration' },
        { value: 'build', label: 'Build an ISO 8601 duration' },
      ],
    },
    {
      name: 'start',
      label: 'Start',
      type: 'text',
      mono: true,
      placeholder: '2024-01-31 or 2024-01-31T12:00:00Z',
      help: 'A moment with no offset is read as UTC.',
      visible: modeIs(...OLD_MODES),
    },
    {
      name: 'businessStart',
      label: 'Start',
      type: 'text',
      mono: true,
      placeholder: '2024-01-08',
      help: 'A plain date written YYYY-MM-DD, with no time and no offset.',
      visible: modeIs('business'),
    },
    {
      name: 'end',
      label: 'End',
      type: 'text',
      mono: true,
      placeholder: '2024-03-01',
      visible: modeIs('difference', 'business'),
    },
    {
      name: 'duration',
      label: 'Duration',
      type: 'text',
      mono: true,
      placeholder: 'P1Y2M10DT2H30M or P1W',
      visible: modeIs('add', 'subtract'),
    },
    {
      name: 'endDay',
      label: 'End day',
      type: 'radio',
      default: 'excluded',
      options: [
        { value: 'excluded', label: 'Not counted' },
        { value: 'included', label: 'Counted' },
      ],
      help: 'Business days read the start and end as plain dates, YYYY-MM-DD. The start day is always counted, also when the end is before the start; the end day is counted only when you choose Counted.',
      visible: modeIs('business'),
    },
    {
      name: 'weekend',
      label: 'Weekend days',
      type: 'text',
      mono: true,
      default: 'Sat, Sun',
      placeholder: 'Sat, Sun',
      help: 'Day names or ISO numbers 1 (Monday) to 7 (Sunday), separated by commas or spaces. Leave empty for none.',
      visible: modeIs('business'),
    },
    {
      name: 'holidays',
      label: 'Holidays',
      type: 'textarea',
      rows: 5,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'One date per line, YYYY-MM-DD, up to 5,000 lines. A holiday on a weekend day is skipped once.',
      visible: modeIs('business'),
    },
    {
      name: 'dates',
      label: 'Dates',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'One date per line, YYYY-MM-DD, up to 5,000 lines.',
      visible: modeIs('weeks'),
    },
    {
      name: 'isoDuration',
      label: 'ISO 8601 duration',
      type: 'text',
      mono: true,
      placeholder: 'P1Y2M3W4DT5H6M7.5S',
      help: 'Weeks may be combined with other parts; only the smallest part can have a decimal fraction. No sign.',
      visible: modeIs('duration'),
    },
    ...BUILD_FIELDS.map(({ name, label }) => ({
      name,
      label,
      type: 'number' as const,
      default: 0,
      min: 0,
      max: MAX_PART,
      step: 1,
      visible: modeIs('build'),
    })),
    {
      name: 'seconds',
      label: 'Seconds',
      type: 'text',
      mono: true,
      default: '0',
      placeholder: '7.5',
      help: 'Digits with an optional decimal fraction, such as 7.5 or 7,5. A bare fraction such as .5, a sign and an exponent such as 1e3 are refused. Zero parts are left out of the result.',
      visible: modeIs('build'),
    },
  ],
  examples: [
    { label: 'End-of-month addition', values: { mode: 'add', start: '2024-01-31', duration: 'P1M' } },
    { label: 'Calendar gap', values: { mode: 'difference', start: '2024-01-31', end: '2024-03-01' } },
    { label: 'Subtract a week', values: { mode: 'subtract', start: '2024-11-03T01:30', duration: 'P1W' } },
    {
      label: 'Business days in a week',
      values: {
        mode: 'business',
        businessStart: '2024-01-01',
        end: '2024-01-08',
        weekend: 'Sat, Sun',
        holidays: '2024-01-03',
      },
    },
    { label: 'Week 53 of 2020', values: { mode: 'weeks', dates: '2021-01-03\n2024-12-30\n2026-12-31' } },
    { label: 'Read a duration', values: { mode: 'duration', isoDuration: 'P1Y2M3W4DT5H6M7.5S' } },
    { label: 'Build a duration', values: { mode: 'build', days: 10, minutes: 30, seconds: '0' } },
  ],
  run(values): ToolResult {
    const selected = modeOf(values);
    if (selected === 'business') return runBusiness(values);
    if (selected === 'weeks') return runWeeks(values);
    if (selected === 'duration') return runDuration(values);
    if (selected === 'build') return runBuild(values);

    const start = str(values, 'start');
    if (!start.trim()) return { outputs: [] };

    let startMs: number;
    try {
      startMs = parseMoment(start);
    } catch (error) {
      if (error instanceof DateDiffError) return { outputs: [], errors: [{ message: error.message }] };
      throw error;
    }

    const mode = str(values, 'mode', 'difference');

    if (mode === 'difference') {
      const end = str(values, 'end');
      if (!end.trim()) return { outputs: [] };

      let endMs: number;
      try {
        endMs = parseMoment(end);
      } catch (error) {
        if (error instanceof DateDiffError) return { outputs: [], errors: [{ message: error.message }] };
        throw error;
      }

      const diff = diffMoments(startMs, endMs);
      const { calendar, exact } = diff;

      const outputs: OutputBlock[] = [
        {
          kind: 'keyvalue',
          label: 'Calendar breakdown',
          pairs: [
            ['Years', String(calendar.years)],
            ['Months', String(calendar.months)],
            ['Days', String(calendar.days)],
            ['Hours', String(calendar.hours)],
            ['Minutes', String(calendar.minutes)],
            ['Seconds', String(calendar.seconds)],
            ['As an ISO 8601 duration', formatIsoDuration(calendar)],
          ],
        },
        {
          kind: 'keyvalue',
          label: 'Exact elapsed time',
          pairs: [
            ['Days', String(exact.days)],
            ['Hours', String(exact.hours)],
            ['Minutes', String(exact.minutes)],
            ['Seconds', String(exact.seconds)],
            ['Total seconds', String(diff.totalSeconds)],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          value:
            diff.sign >= 0
              ? 'End is at or after start.'
              : 'End is before start; the values above are the size of the gap, not signed.',
        },
      ];

      return { outputs };
    }

    const durationText = str(values, 'duration');
    if (!durationText.trim()) return { outputs: [] };

    let duration;
    try {
      duration = parseDuration(durationText);
    } catch (error) {
      if (error instanceof DateDiffError) return { outputs: [], errors: [{ message: error.message }] };
      throw error;
    }

    const resultMs = addDuration(startMs, duration, mode === 'subtract' ? -1 : 1);
    const resultIso = new Date(resultMs).toISOString();

    return {
      outputs: [
        {
          kind: 'keyvalue',
          label: mode === 'subtract' ? 'Start minus the duration' : 'Start plus the duration',
          pairs: [
            ['Result (UTC)', resultIso],
            ['Date only', resultIso.slice(0, 10)],
          ],
        },
      ],
    };
  },
});
