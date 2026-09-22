import { meta, format, toTree, suggestRepairs, type IndentStyle, type SortOrder } from '@fodt/json-formatter';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'json-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'input', label: 'JSON', type: 'textarea', rows: 14, placeholder: '{ "hello": "world" }' },
    {
      name: 'indent',
      label: 'Output',
      type: 'select',
      default: '2',
      options: [
        { value: '2', label: 'Indent 2 spaces' },
        { value: '4', label: 'Indent 4 spaces' },
        { value: 'tab', label: 'Indent with tabs' },
        { value: 'minify', label: 'Minify to one line' },
      ],
    },
    {
      name: 'sortKeys',
      label: 'Sort keys',
      type: 'select',
      default: 'none',
      options: [
        { value: 'none', label: 'Keep the original order' },
        { value: 'asc', label: 'A to Z' },
        { value: 'desc', label: 'Z to A' },
      ],
    },
    {
      name: 'duplicateKeys',
      label: 'When a key repeats',
      type: 'select',
      default: 'last',
      options: [
        { value: 'last', label: 'Keep the last value (what JSON.parse does)' },
        { value: 'first', label: 'Keep the first value' },
        { value: 'error', label: 'Refuse the document' },
      ],
    },
    { name: 'allowComments', label: 'Allow comments and trailing commas (JSONC)', type: 'checkbox', default: false },
    { name: 'asciiOnly', label: 'Escape everything above ASCII as \\uXXXX', type: 'checkbox', default: false },
    { name: 'jsonLines', label: 'Output a top-level array as JSON Lines', type: 'checkbox', default: false },
    { name: 'showTree', label: 'Show the structure as a tree', type: 'checkbox', default: false },
  ],
  examples: [
    { label: 'Nested', values: { input: '{"user":{"id":1,"roles":["admin","dev"],"active":true},"meta":null}' } },
    { label: 'Duplicate keys', values: { input: '{"a": 1, "b": 2, "a": 3}' } },
    { label: 'Big number', values: { input: '{"tweet_id": 1234567890123456789}' } },
    { label: 'JSONC', values: { input: '{\n  // a comment\n  "strict": true,\n}', allowComments: true } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const result = format(input, {
      indent: str(values, 'indent', '2') as IndentStyle,
      sortKeys: str(values, 'sortKeys', 'none') as SortOrder,
      duplicateKeys: str(values, 'duplicateKeys', 'last') as 'last' | 'first' | 'error',
      allowComments: bool(values, 'allowComments'),
      allowTrailingCommas: bool(values, 'allowComments'),
      asciiOnly: bool(values, 'asciiOnly'),
      jsonLines: bool(values, 'jsonLines'),
    });

    if (!result.ok) {
      const repairs = suggestRepairs(input);
      const outputs: OutputBlock[] = repairs.map((r) => ({
        kind: 'note' as const,
        tone: 'info' as const,
        value: `Suggestion: ${r.description}`,
      }));
      return {
        outputs,
        errors: [
          {
            message: result.error!.message,
            line: result.error!.line,
            column: result.error!.column,
            path: result.error!.path,
          },
        ],
      };
    }

    const outputs: OutputBlock[] = [
      {
        kind: 'code',
        label: 'Formatted',
        language: 'json',
        value: result.output,
        download: bool(values, 'jsonLines') ? 'data.jsonl' : 'formatted.json',
      },
    ];

    if (result.duplicates.length > 0) {
      outputs.unshift({
        kind: 'table',
        label: `${result.duplicates.length} duplicate key${result.duplicates.length === 1 ? '' : 's'} found`,
        table: {
          headers: ['Path', 'Key', 'Occurrence', 'Line', 'Column'],
          rows: result.duplicates.map((d) => [d.path, d.key, d.occurrences, d.line, d.column]),
          mono: [0, 1],
        },
      });
      outputs.unshift({
        kind: 'note',
        tone: 'warn',
        value:
          'This document repeats a key. RFC 8259 leaves the result undefined, and parsers disagree: JavaScript, Python and Go keep the last value, some streaming parsers keep the first. Only one value survives in the output below.',
      });
    }

    if (result.precisionLoss.length > 0) {
      outputs.unshift({
        kind: 'table',
        label: `${result.precisionLoss.length} number${result.precisionLoss.length === 1 ? '' : 's'} changed when parsed`,
        table: {
          headers: ['Path', 'In the document', 'After parsing', 'Line'],
          rows: result.precisionLoss.map((p) => [p.path, p.raw, p.stored, p.line]),
          mono: [0, 1, 2],
        },
      });
      outputs.unshift({
        kind: 'note',
        tone: 'warn',
        value:
          'These numbers do not survive being stored as a double. This is not a bug in this tool: every JSON parser that uses doubles does the same, which is why large ids should be sent as strings.',
      });
    }

    if (bool(values, 'showTree') && result.value !== undefined) {
      const nodes = toTree(result.value, 2000);
      outputs.push({
        kind: 'table',
        label: 'Structure',
        table: {
          headers: ['Path', 'Type', 'Value'],
          rows: nodes.map((n) => [`${'  '.repeat(n.depth)}${n.path}`, n.type, n.preview]),
          mono: [0, 2],
        },
      });
    }

    const saved = result.inputBytes - result.outputBytes;
    return {
      outputs,
      stats: [
        ['Input', `${result.inputBytes} bytes`],
        ['Output', `${result.outputBytes} bytes`],
        ...(saved !== 0 ? ([[saved > 0 ? 'Saved' : 'Added', `${Math.abs(saved)} bytes`]] as [string, string][]) : []),
        ['Keys', String(result.stats.keys)],
        ['Depth', String(result.stats.maxDepth)],
      ],
    };
  },
});
