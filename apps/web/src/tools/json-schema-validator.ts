import { meta } from '@fodt/json-schema-validator';
import { jsonSchemaInWorker, SchemaRunError } from '../lib/run-json-schema-in-worker';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'json-schema-validator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  cancellable: true,
  fields: [
    {
      name: 'schema',
      label: 'Schema',
      type: 'textarea',
      rows: 10,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'data',
      label: 'Data',
      type: 'textarea',
      rows: 10,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'draft',
      label: 'Draft',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Detect from the schema (2020-12 when not declared)' },
        { value: 'draft-07', label: 'draft-07' },
        { value: '2020-12', label: '2020-12' },
      ],
    },
    { name: 'checkFormats', label: 'Check format keywords', type: 'checkbox', default: true },
  ],
  examples: [
    {
      label: 'Age must be non-negative',
      values: {
        schema: '{"type":"object","properties":{"age":{"type":"integer","minimum":0}},"required":["age"]}',
        data: '{"age":-1}',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const schemaText = str(values, 'schema');
    const dataText = str(values, 'data');
    if (!schemaText.trim() || !dataText.trim()) return { outputs: [] };

    const draft = str(values, 'draft', 'auto') as 'auto' | 'draft-07' | '2020-12';
    const checkFormats = bool(values, 'checkFormats', true);

    try {
      const result = await jsonSchemaInWorker(
        { type: 'json-schema-job', schemaText, dataText, draft, checkFormats },
        ctx,
      );
      return renderResult(result);
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own cancellation note already owns that message. Every
      // other rejection -- including the time-limit message the worker
      // helper composes on its own -- is shown as an input problem.
      if (ctx.signal.aborted) throw err;
      if (err instanceof SchemaRunError) {
        return {
          outputs: [],
          errors: [{ message: err.message, line: err.line, column: err.column }],
        };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'This schema could not be validated.' }],
      };
    }
  },
});

function renderResult(result: {
  valid: boolean;
  draft: string;
  errors: { path: string; keyword: string; message: string; schemaPath: string }[];
}): ToolResult {
  if (result.valid) {
    return {
      outputs: [{ kind: 'note', tone: 'success', value: `Valid against ${result.draft}.` }],
      stats: [
        ['Errors', '0'],
        ['Draft', result.draft],
      ],
    };
  }
  return {
    outputs: [
      {
        kind: 'table',
        label: 'Violations',
        table: {
          headers: ['Path', 'Keyword', 'Message', 'Schema path'],
          rows: result.errors.map((e) => [
            e.path === '' ? '(whole document)' : e.path,
            e.keyword,
            e.message,
            e.schemaPath,
          ]),
          mono: [0, 3],
        },
      },
    ],
    stats: [
      ['Errors', String(result.errors.length)],
      ['Draft', result.draft],
    ],
  };
}
