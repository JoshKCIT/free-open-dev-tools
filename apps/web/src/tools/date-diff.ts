import {
  meta,
  parseMoment,
  parseDuration,
  diffMoments,
  addDuration,
  formatIsoDuration,
  DateDiffError,
} from '@fodt/date-diff';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

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
      ],
    },
    {
      name: 'start',
      label: 'Start',
      type: 'text',
      mono: true,
      placeholder: '2024-01-31 or 2024-01-31T12:00:00Z',
      help: 'A moment with no offset is read as UTC.',
    },
    {
      name: 'end',
      label: 'End',
      type: 'text',
      mono: true,
      placeholder: '2024-03-01',
      visible: (values) => str(values, 'mode', 'difference') === 'difference',
    },
    {
      name: 'duration',
      label: 'Duration',
      type: 'text',
      mono: true,
      placeholder: 'P1Y2M10DT2H30M or P1W',
      visible: (values) => str(values, 'mode', 'difference') !== 'difference',
    },
  ],
  examples: [
    { label: 'End-of-month addition', values: { mode: 'add', start: '2024-01-31', duration: 'P1M' } },
    { label: 'Calendar gap', values: { mode: 'difference', start: '2024-01-31', end: '2024-03-01' } },
    { label: 'Subtract a week', values: { mode: 'subtract', start: '2024-11-03T01:30', duration: 'P1W' } },
  ],
  run(values): ToolResult {
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
