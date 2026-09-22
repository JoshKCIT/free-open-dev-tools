import { meta, parseInput, render, COMMON_ZONES, isValidZone, type TimeUnit } from '@fodt/unix-timestamp';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'unix-timestamp',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Timestamp or date',
      type: 'text',
      mono: true,
      placeholder: '1767225600, 1767225600000, or 2026-01-15T12:30:00Z',
      help: 'A bare number is read in whichever unit fits. A date with no zone is read as UTC.',
    },
    {
      name: 'unit',
      label: 'Force the unit',
      type: 'select',
      default: '',
      options: [
        { value: '', label: 'Detect automatically' },
        { value: 'seconds', label: 'Seconds' },
        { value: 'milliseconds', label: 'Milliseconds' },
        { value: 'microseconds', label: 'Microseconds' },
        { value: 'nanoseconds', label: 'Nanoseconds' },
      ],
    },
    {
      name: 'zone',
      label: 'Time zone',
      type: 'select',
      default: 'UTC',
      options: COMMON_ZONES.map((z) => ({ value: z, label: z })),
    },
    {
      name: 'customZone',
      label: 'Or any IANA zone name',
      type: 'text',
      mono: true,
      placeholder: 'Europe/Lisbon',
    },
  ],
  examples: [
    { label: 'Seconds', values: { input: '1767225600' } },
    { label: 'Milliseconds', values: { input: '1767225600123' } },
    { label: 'ISO date', values: { input: '2026-01-15T12:30:00Z' } },
    { label: '2038 overflow', values: { input: '2147483647' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const forced = str(values, 'unit');
    const parsed = parseInput(input, forced ? (forced as TimeUnit) : undefined);
    if (!parsed.ok) return { outputs: [], errors: [{ message: parsed.error ?? 'Could not read that value.' }] };

    const custom = str(values, 'customZone').trim();
    const zone = custom || str(values, 'zone', 'UTC');
    if (custom && !isValidZone(custom)) {
      return {
        outputs: [],
        errors: [
          {
            message: `"${custom}" is not an IANA time zone name your browser knows. Try a name such as Europe/Lisbon.`,
          },
        ],
      };
    }

    const r = render(parsed.ms!, { timeZone: zone });

    const outputs: OutputBlock[] = [
      { kind: 'note', tone: parsed.confident ? 'info' : 'warn', value: parsed.interpretation },
      {
        kind: 'keyvalue',
        label: 'Date and time',
        pairs: [
          ['ISO 8601 (UTC)', r.iso],
          ['HTTP date', r.rfc7231],
          [`In ${zone}`, `${r.inZone} ${r.zoneAbbreviation} (UTC${r.zoneOffset})`],
          ['ISO 8601 with offset', r.isoLocal],
          ['Relative to now', r.relative],
        ],
      },
      {
        kind: 'keyvalue',
        label: 'Epoch value in each unit',
        pairs: [
          ['Seconds', String(r.epochSeconds)],
          ['Milliseconds', String(r.epochMilliseconds)],
          ['Microseconds', String(r.epochMicroseconds)],
          ['Nanoseconds', r.epochNanoseconds],
        ],
      },
      {
        kind: 'keyvalue',
        label: 'Calendar facts',
        pairs: [
          ['Day of the week', r.dayOfWeek],
          ['Day of the year', String(r.dayOfYear)],
          ['ISO week', r.isoWeek],
          ['Quarter', `Q${r.quarter}`],
          ['Leap year', r.isLeapYear ? 'yes' : 'no'],
        ],
      },
    ];

    if (!parsed.confident) {
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value:
          'That number is small enough that the unit is a guess. Choose the unit explicitly above if this is not what you meant.',
      });
    }

    return { outputs };
  },
});
