import { meta, type JsonPathMatch } from '@fodt/jsonpath';
import { jsonPathInWorker, JsonPathRunError } from '../lib/run-jsonpath-in-worker';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

const MAX_VALUE_PREVIEW = 200;

function previewValue(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) return 'undefined';
  return text.length > MAX_VALUE_PREVIEW ? `${text.slice(0, MAX_VALUE_PREVIEW)}...` : text;
}

export default defineTool({
  id: 'jsonpath',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  cancellable: true,
  fields: [
    {
      name: 'document',
      label: 'JSON document',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'expression',
      label: 'JSONPath expression',
      type: 'text',
      mono: true,
      default: '$',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
  ],
  examples: [
    {
      label: 'Books under 10',
      values: {
        document:
          '{"store":{"book":[{"title":"Sayings of the Century","price":8.95},{"title":"Sword of Honour","price":12.99}]}}',
        expression: '$..book[?@.price<10]',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const documentText = str(values, 'document');
    const expression = str(values, 'expression', '$');
    if (!documentText.trim() || !expression) return { outputs: [] };

    try {
      const result = await jsonPathInWorker({ type: 'jsonpath-job', documentText, expression }, ctx);
      return renderMatches(result.matches);
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own cancellation note already owns that message. Every
      // other rejection -- including the time-limit message the worker
      // helper composes on its own -- is shown as an input problem.
      if (ctx.signal.aborted) throw err;
      if (err instanceof JsonPathRunError) {
        return {
          outputs: [],
          errors: [{ message: err.message, line: err.kind === 'document' ? err.line : 1, column: err.column }],
        };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'This query could not be run.' }],
      };
    }
  },
});

function renderMatches(matches: JsonPathMatch[]): ToolResult {
  if (matches.length === 0) {
    return {
      outputs: [{ kind: 'note', tone: 'info', value: 'No match.' }],
      stats: [['Matches', '0']],
    };
  }
  return {
    outputs: [
      {
        kind: 'table',
        label: 'Matches',
        table: {
          headers: ['Normalized path', 'Value'],
          rows: matches.map((m) => [m.path, previewValue(m.value)]),
          mono: [0, 1],
        },
      },
      {
        kind: 'code',
        label: 'Values as a JSON array',
        language: 'json',
        value: JSON.stringify(
          matches.map((m) => m.value),
          null,
          2,
        ),
      },
    ],
    stats: [['Matches', String(matches.length)]],
  };
}
