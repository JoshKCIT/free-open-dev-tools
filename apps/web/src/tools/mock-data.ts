import { meta, generateMockData, MockDataError, type MockDataFormat } from '@fodt/mock-data';
import { defineTool, str, num, type Field, type ToolResult } from '../lib/tool-ui';

const REFERENCE_FIELDS = [
  'id: id',
  'name: fullName',
  'email: email',
  'joined: date(2000-01-01, 2024-12-31)',
  'score: decimal(0, 100, 2)',
  'active: boolean',
  'ip: ipv4',
  'key: uuid',
].join('\n');

const LANGUAGE: Record<MockDataFormat, string | undefined> = { json: 'json', jsonl: undefined, csv: undefined };

const fields: Field[] = [
  { name: 'seed', label: 'Seed', type: 'text', default: 'demo' },
  { name: 'count', label: 'Records', type: 'number', default: 10, min: 1, max: 1000 },
  {
    name: 'fields',
    label: 'Fields (one "name: kind" per line)',
    type: 'textarea',
    rows: 10,
    default: REFERENCE_FIELDS,
  },
  {
    name: 'format',
    label: 'Format',
    type: 'select',
    default: 'json',
    options: [
      { value: 'json', label: 'JSON' },
      { value: 'jsonl', label: 'JSON Lines' },
      { value: 'csv', label: 'CSV' },
    ],
  },
];

export default defineTool({
  id: 'mock-data',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields,
  run(values): ToolResult {
    const seed = str(values, 'seed', 'demo');
    const count = Math.trunc(num(values, 'count', 10));
    const fieldsText = str(values, 'fields', REFERENCE_FIELDS);
    const format = str(values, 'format', 'json') as MockDataFormat;

    if (fieldsText.trim() === '') return { outputs: [] };

    try {
      const result = generateMockData({ seed, count, fields: fieldsText, format });
      return {
        outputs: [{ kind: 'code', label: 'Output', language: LANGUAGE[format], value: result.output }],
        stats: [
          ['Records', String(result.records)],
          ['Fields', String(result.fields)],
        ],
      };
    } catch (err) {
      if (err instanceof MockDataError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line }] };
      }
      const message = err instanceof Error ? err.message : 'Could not generate records for that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
