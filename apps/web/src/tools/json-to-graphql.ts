import { meta, jsonToGraphql, JsonToGraphqlError } from '@fodt/json-to-graphql';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'json-to-graphql',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Sample JSON',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'samplesAre',
      label: 'The input is',
      type: 'radio',
      default: 'single',
      options: [
        { value: 'single', label: 'One sample object' },
        { value: 'array', label: 'An array of sample objects' },
      ],
    },
    { name: 'rootName', label: 'Root type name', type: 'text', default: 'Root' },
    { name: 'nonNullWhenAlwaysPresent', label: 'Non-null when always present', type: 'checkbox', default: true },
    { name: 'idFields', label: 'Detect id fields', type: 'checkbox', default: true },
    { name: 'addQuery', label: 'Add a root Query field', type: 'checkbox', default: true },
  ],
  examples: [
    { label: 'Object with id and a list', values: { input: '{"id":1,"name":"Ada","tags":["a"]}' } },
    {
      label: 'Multiple samples merged',
      values: { input: '[{"a":1},{"b":"x"}]', samplesAre: 'array' },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const samplesAre = str(values, 'samplesAre', 'single') === 'array' ? 'array' : 'single';
    const rootNameInput = str(values, 'rootName', 'Root');

    try {
      const result = jsonToGraphql(input, {
        samplesAre,
        rootName: rootNameInput.trim() === '' ? 'Root' : rootNameInput,
        nonNullWhenAlwaysPresent: bool(values, 'nonNullWhenAlwaysPresent', true),
        idFields: bool(values, 'idFields', true),
        addQuery: bool(values, 'addQuery', true),
      });
      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'GraphQL', language: 'graphql', value: result.output, download: 'schema.graphql' },
      ];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }
      return { outputs, stats: [['Types', String(result.types)]] };
    } catch (err) {
      if (err instanceof JsonToGraphqlError) {
        return {
          outputs: [],
          errors: [{ message: err.message, line: err.line, column: err.column, path: err.path }],
        };
      }
      const message = err instanceof Error ? err.message : 'Could not process that document.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
