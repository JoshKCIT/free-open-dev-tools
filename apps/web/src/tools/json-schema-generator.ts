import { meta, generateSchema, SchemaGeneratorError, type InputFormat } from '@fodt/json-schema-generator';
import {
  JSON_SCHEMA_GENERATOR_TIME_LIMIT_MS,
  jsonSchemaGeneratorInWorker,
  JsonSchemaGeneratorRunError,
} from '../lib/run-json-schema-generator-in-worker';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'json-schema-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // YAML samples are read in a background worker with a 5 second time limit (checking a mapping's keys for
  // duplicates grows with the square of the key count), so that run can be cancelled. JSON and XML samples stay
  // synchronous.
  cancellable: true,
  runLimit: { ms: JSON_SCHEMA_GENERATOR_TIME_LIMIT_MS },
  fields: [
    {
      name: 'samples',
      label: 'Sample documents',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'inputFormat',
      label: 'Input format',
      type: 'select',
      default: 'json',
      help: 'The samples above are read in this format. YAML keeps the choice below (a list at the top, or a --- stream of documents); XML reads one document.',
      options: [
        { value: 'json', label: 'JSON' },
        { value: 'yaml', label: 'YAML' },
        { value: 'xml', label: 'XML' },
      ],
    },
    {
      name: 'parseValues',
      label: 'Read numbers and booleans',
      type: 'checkbox',
      default: true,
      help: 'XML text is a number or boolean only when written the way JSON writes one; otherwise every XML value is a string.',
      visible: (values) => str(values, 'inputFormat', 'json') === 'xml',
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
    {
      label: 'YAML samples',
      values: { inputFormat: 'yaml', samples: '- id: 1\n  name: Ada\n- id: 2\n', samplesAre: 'array' },
    },
    {
      label: 'An XML document',
      values: { inputFormat: 'xml', samples: '<person id="1"><name>Ada</name></person>' },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const samples = str(values, 'samples');
    if (!samples.trim()) return { outputs: [] };

    const samplesAre = str(values, 'samplesAre', 'single') as 'single' | 'array' | 'lines';
    const draft = str(values, 'draft', '2020-12') as 'draft-07' | '2020-12';
    const detectFormats = bool(values, 'detectFormats', true);
    const inputFormat = str(values, 'inputFormat', 'json') as InputFormat;
    const parseValues = bool(values, 'parseValues', true);

    try {
      const options = { samplesAre, draft, detectFormats, inputFormat, parseValues };
      // Only YAML samples carry the quadratic duplicate-key risk, so only they are routed through the worker.
      const result =
        inputFormat === 'yaml'
          ? await jsonSchemaGeneratorInWorker({ type: 'json-schema-generator-job', samples, options }, ctx)
          : generateSchema(samples, options);
      return {
        outputs: [{ kind: 'code', label: 'Generated schema', language: 'json', value: result.output }],
        warnings: result.warnings,
        stats: [['Samples', String(result.sampleCount)]],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof SchemaGeneratorError || err instanceof JsonSchemaGeneratorRunError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'A schema could not be inferred.' }],
      };
    }
  },
});
