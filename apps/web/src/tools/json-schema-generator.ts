import { meta, generateSchema, SchemaGeneratorError } from '@fodt/json-schema-generator';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'json-schema-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'samples',
      label: 'Sample documents',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'samplesAre',
      label: 'Samples are',
      type: 'select',
      default: 'single',
      options: [
        { value: 'single', label: 'One document' },
        { value: 'array', label: 'A JSON array of sample documents' },
        { value: 'lines', label: 'JSON Lines (one document per line)' },
      ],
    },
    {
      name: 'draft',
      label: 'Draft',
      type: 'select',
      default: '2020-12',
      options: [
        { value: '2020-12', label: '2020-12' },
        { value: 'draft-07', label: 'draft-07' },
      ],
    },
    { name: 'detectFormats', label: 'Detect string formats', type: 'checkbox', default: true },
  ],
  examples: [
    {
      label: 'Two users, one missing a name',
      values: { samples: '[{"id":1,"name":"Ada"},{"id":2}]', samplesAre: 'array' },
    },
  ],
  run(values): ToolResult {
    const samples = str(values, 'samples');
    if (!samples.trim()) return { outputs: [] };

    const samplesAre = str(values, 'samplesAre', 'single') as 'single' | 'array' | 'lines';
    const draft = str(values, 'draft', '2020-12') as 'draft-07' | '2020-12';
    const detectFormats = bool(values, 'detectFormats', true);

    try {
      const result = generateSchema(samples, { samplesAre, draft, detectFormats });
      return {
        outputs: [{ kind: 'code', label: 'Generated schema', language: 'json', value: result.output }],
        stats: [['Samples', String(result.sampleCount)]],
      };
    } catch (err) {
      if (err instanceof SchemaGeneratorError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'A schema could not be inferred.' }],
      };
    }
  },
});
