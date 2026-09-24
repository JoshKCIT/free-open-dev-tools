import { meta, parseCron, nextRuns, describeCron, DIALECTS, type Dialect } from '@fodt/cron-expression';
import { defineTool, str, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default defineTool({
  id: 'cron-expression',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'dialect',
      label: 'Dialect',
      type: 'select',
      default: 'unix',
      options: [
        { value: 'unix', label: 'Unix (crontab, 5 fields)' },
        { value: 'quartz', label: 'Quartz (6 or 7 fields, with seconds)' },
      ],
    },
    {
      name: 'expression',
      label: 'Cron expression',
      type: 'text',
      mono: true,
      default: '30 4 1,15 * 5',
      placeholder: '30 4 1,15 * 5',
    },
    {
      name: 'from',
      label: 'From (UTC instant)',
      type: 'text',
      mono: true,
      placeholder: 'Empty means now',
      help: 'ISO 8601, such as 2024-01-01T00:00:00Z. Empty means the current time.',
    },
    {
      name: 'count',
      label: 'Number of runs',
      type: 'number',
      default: 10,
      min: 1,
      max: 50,
    },
  ],
  examples: [
    {
      label: 'crontab(5) worked example',
      values: { dialect: 'unix', expression: '30 4 1,15 * 5', from: '2024-01-01T00:00:00Z', count: 10 },
    },
    {
      label: 'Quartz tutorial: third Friday of the month',
      values: { dialect: 'quartz', expression: '0 15 10 ? * 6#3', from: '2024-01-01T00:00:00Z', count: 5 },
    },
  ],
  run(values): ToolResult {
    const dialect = str(values, 'dialect', 'unix') as Dialect;
    const expression = str(values, 'expression');
    if (!expression.trim()) return { outputs: [] };

    if (!DIALECTS.includes(dialect)) {
      return { outputs: [], errors: [{ message: `The ${dialect} dialect is not supported yet.` }] };
    }

    const fromText = str(values, 'from').trim();
    let from: Date;
    if (fromText === '') {
      from = new Date();
    } else {
      const parsedFrom = new Date(fromText);
      if (Number.isNaN(parsedFrom.getTime())) {
        return {
          outputs: [],
          errors: [
            {
              message: `"${fromText}" is not a date this page can read. Use an ISO 8601 instant, such as 2024-01-01T00:00:00Z.`,
            },
          ],
        };
      }
      from = parsedFrom;
    }

    const count = num(values, 'count', 10);

    try {
      const parsed = parseCron(expression, dialect);
      const result = nextRuns(parsed, from, count);
      const outputs: OutputBlock[] = [];

      outputs.push({ kind: 'text', label: 'In plain English', value: describeCron(parsed) });

      if (result.runs.length > 0) {
        outputs.push({
          kind: 'table',
          label: 'Next runs (UTC)',
          table: {
            headers: ['#', 'Run (UTC ISO)', 'Weekday'],
            rows: result.runs.map((d, i) => [i + 1, d.toISOString(), WEEKDAY_NAMES[d.getUTCDay()]!]),
          },
        });
      }

      if (result.neverMessage) {
        outputs.push({ kind: 'note', tone: 'warn', value: result.neverMessage });
      }

      return { outputs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { outputs: [], errors: [{ message }] };
    }
  },
});
