import { meta, jsonToZod, JsonToZodError } from '@fodt/json-to-zod';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'json-to-zod',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'source',
      label: 'Input is',
      type: 'radio',
      default: 'sample',
      options: [
        { value: 'sample', label: 'A JSON sample' },
        { value: 'schema', label: 'A JSON Schema' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    { name: 'exportName', label: 'Export name', type: 'text', default: 'schema' },
  ],
  examples: [
    { label: 'Sample', values: { source: 'sample', input: '{"id":1,"name":"Ada","tags":["x"]}' } },
    {
      label: 'JSON Schema with required and enum',
      values: {
        source: 'schema',
        input:
          '{"type":"object","properties":{"id":{"type":"integer"},"role":{"enum":["admin","user"]}},"required":["id"]}',
      },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const source = str(values, 'source', 'sample') as 'sample' | 'schema';
    const exportName = str(values, 'exportName', 'schema');

    try {
      const result = jsonToZod(input, { source, exportName: exportName.trim() === '' ? 'schema' : exportName });
      return {
        outputs: [{ kind: 'code', label: 'Zod schema', language: 'typescript', value: result.output }],
        warnings: result.warnings,
      };
    } catch (err) {
      if (err instanceof JsonToZodError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that document.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
