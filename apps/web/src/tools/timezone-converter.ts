import {
  meta,
  convertMoment,
  findTransitions,
  isValidZone,
  COMMON_ZONES,
  TimeZoneError,
} from '@fodt/timezone-converter';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'timezone-converter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'moment',
      label: 'Moment',
      type: 'text',
      mono: true,
      default: '2024-11-03T01:30',
      placeholder: '2024-11-03T01:30, or with a zone: 2024-11-03T01:30Z',
      help: 'A wall-clock time with no offset is read in the From zone below. Add Z or ±HH:MM to state the offset directly.',
    },
    {
      name: 'fromZone',
      label: 'From zone',
      type: 'select',
      default: 'America/New_York',
      options: [...COMMON_ZONES.map((z) => ({ value: z, label: z })), { value: 'other', label: 'Other…' }],
    },
    {
      name: 'fromCustom',
      label: 'Or any IANA zone name',
      type: 'text',
      mono: true,
      placeholder: 'Europe/Lisbon',
      visible: (values) => str(values, 'fromZone') === 'other',
    },
    {
      name: 'toZone',
      label: 'To zone',
      type: 'select',
      default: 'UTC',
      options: [...COMMON_ZONES.map((z) => ({ value: z, label: z })), { value: 'other', label: 'Other…' }],
    },
    {
      name: 'toCustom',
      label: 'Or any IANA zone name',
      type: 'text',
      mono: true,
      placeholder: 'Europe/Lisbon',
      visible: (values) => str(values, 'toZone') === 'other',
    },
  ],
  examples: [
    {
      label: 'Fall-back overlap (New York)',
      values: { moment: '2024-11-03T01:30', fromZone: 'America/New_York', toZone: 'UTC' },
    },
    {
      label: 'Spring-forward gap (New York)',
      values: { moment: '2024-03-10T02:30', fromZone: 'America/New_York', toZone: 'UTC' },
    },
    {
      label: 'London to Kolkata',
      values: { moment: '2024-06-15T09:00', fromZone: 'Europe/London', toZone: 'Asia/Kolkata' },
    },
  ],
  run(values): ToolResult {
    const moment = str(values, 'moment');
    if (!moment.trim()) return { outputs: [] };

    const fromCustom = str(values, 'fromCustom').trim();
    const fromZone = fromCustom || str(values, 'fromZone', 'UTC');
    if (fromCustom && !isValidZone(fromCustom)) {
      return {
        outputs: [],
        errors: [
          {
            message: `"${fromCustom}" is not an IANA time zone name your browser knows. Try a name such as Europe/Lisbon.`,
          },
        ],
      };
    }

    const toCustom = str(values, 'toCustom').trim();
    const toZone = toCustom || str(values, 'toZone', 'UTC');
    if (toCustom && !isValidZone(toCustom)) {
      return {
        outputs: [],
        errors: [
          {
            message: `"${toCustom}" is not an IANA time zone name your browser knows. Try a name such as Europe/Lisbon.`,
          },
        ],
      };
    }

    let result;
    try {
      result = convertMoment(moment, fromZone, toZone);
    } catch (error) {
      if (error instanceof TimeZoneError) return { outputs: [], errors: [{ message: error.message }] };
      throw error;
    }

    const outputs: OutputBlock[] = [
      {
        kind: 'keyvalue',
        label: 'Converted',
        pairs: [
          [`From (${fromZone})`, `${result.from.wall} ${result.from.abbreviation} (UTC${result.from.offset})`],
          [`To (${toZone})`, `${result.to.wall} ${result.to.abbreviation} (UTC${result.to.offset})`],
          ['UTC', result.instantUtc],
        ],
      },
    ];

    if (result.note) {
      outputs.push({ kind: 'note', tone: 'warn', value: result.note });
      if (result.alternative) {
        outputs.push({
          kind: 'keyvalue',
          label: 'Second reading',
          pairs: [
            [
              `From (${fromZone})`,
              `${result.alternative.wall} ${result.alternative.abbreviation} (UTC${result.alternative.offset})`,
            ],
            ['UTC', result.alternative.instantUtc],
          ],
        });
      }
    }

    const year = Number(moment.slice(0, 4));
    if (Number.isFinite(year)) {
      const fromTransitions = findTransitions(fromZone, year);
      const toTransitions = fromZone === toZone ? [] : findTransitions(toZone, year);
      const rows = [
        ...fromTransitions.map((t) => [fromZone, t.atUtc, `${t.offsetBefore} → ${t.offsetAfter}`]),
        ...toTransitions.map((t) => [toZone, t.atUtc, `${t.offsetBefore} → ${t.offsetAfter}`]),
      ];
      if (rows.length > 0) {
        outputs.push({
          kind: 'table',
          label: `Clock changes in ${year}`,
          table: { headers: ['Zone', 'UTC instant', 'Offset change'], rows },
        });
      }
    }

    return { outputs };
  },
});
