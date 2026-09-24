import { meta, processLines, OPERATIONS, type LineOperation } from '@fodt/text-lines';
import { defineTool, str, bool, num, type Values, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const OPERATION_LABELS: Record<LineOperation, string> = {
  sort: 'Sort',
  dedupe: 'Deduplicate',
  shuffle: 'Shuffle',
  number: 'Number',
  trim: 'Trim',
  filter: 'Filter',
  join: 'Join',
  split: 'Split',
};

const isOp = (values: Values, op: LineOperation) => str(values, 'operation', 'sort') === op;

export default defineTool({
  id: 'text-lines',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Lines',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'operation',
      label: 'Operation',
      type: 'select',
      default: 'sort',
      options: OPERATIONS.map((op) => ({ value: op, label: OPERATION_LABELS[op] })),
    },
    {
      name: 'order',
      label: 'Sort order',
      type: 'select',
      default: 'codepoint',
      options: [
        { value: 'codepoint', label: 'Code point' },
        { value: 'natural', label: 'Natural (line 2 before line 10)' },
      ],
      visible: (values) => isOp(values, 'sort'),
    },
    {
      name: 'descending',
      label: 'Descending',
      type: 'checkbox',
      default: false,
      visible: (values) => isOp(values, 'sort'),
    },
    {
      name: 'ignoreCase',
      label: 'Ignore case',
      type: 'checkbox',
      default: false,
      visible: (values) => isOp(values, 'dedupe') || isOp(values, 'filter'),
    },
    { name: 'seed', label: 'Seed', type: 'text', default: '1', visible: (values) => isOp(values, 'shuffle') },
    {
      name: 'start',
      label: 'Start at',
      type: 'number',
      default: 1,
      visible: (values) => isOp(values, 'number'),
    },
    {
      name: 'separator',
      label: 'Separator',
      type: 'text',
      default: '. ',
      visible: (values) => isOp(values, 'number'),
    },
    {
      name: 'trimMode',
      label: 'Trim',
      type: 'select',
      default: 'both',
      options: [
        { value: 'both', label: 'Leading and trailing' },
        { value: 'leading', label: 'Leading only' },
        { value: 'trailing', label: 'Trailing only' },
      ],
      visible: (values) => isOp(values, 'trim'),
    },
    {
      name: 'dropBlank',
      label: 'Drop blank lines',
      type: 'checkbox',
      default: false,
      visible: (values) => isOp(values, 'trim'),
    },
    {
      name: 'filterText',
      label: 'Text to match',
      type: 'text',
      visible: (values) => isOp(values, 'filter'),
    },
    {
      name: 'filterMode',
      label: 'Keep or remove',
      type: 'select',
      default: 'keep',
      options: [
        { value: 'keep', label: 'Keep matching lines' },
        { value: 'remove', label: 'Remove matching lines' },
      ],
      visible: (values) => isOp(values, 'filter'),
    },
    {
      name: 'joinWith',
      label: 'Join with',
      type: 'text',
      default: ', ',
      visible: (values) => isOp(values, 'join'),
    },
    {
      name: 'splitOn',
      label: 'Split on',
      type: 'text',
      default: ',',
      visible: (values) => isOp(values, 'split'),
    },
  ],
  examples: [
    { label: 'Sort', values: { input: 'banana\napple\ncherry', operation: 'sort' } },
    { label: 'Natural order', values: { input: 'line 10\nline 2\nline 1', operation: 'sort', order: 'natural' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    const operation = str(values, 'operation', 'sort') as LineOperation;
    try {
      const result = processLines(input, operation, {
        order: str(values, 'order', 'codepoint') as 'codepoint' | 'natural',
        descending: bool(values, 'descending'),
        ignoreCase: bool(values, 'ignoreCase'),
        seed: str(values, 'seed', '1'),
        start: num(values, 'start', 1),
        separator: str(values, 'separator', '. '),
        mode: str(values, 'trimMode', 'both') as 'both' | 'leading' | 'trailing',
        dropBlank: bool(values, 'dropBlank'),
        filterText: str(values, 'filterText'),
        filterMode: str(values, 'filterMode', 'keep') as 'keep' | 'remove',
        joinWith: str(values, 'joinWith', ', '),
        splitOn: str(values, 'splitOn', ','),
      });

      const outputs: OutputBlock[] = [{ kind: 'code', value: result.output }];
      return {
        outputs,
        stats: [
          ['Lines in', String(result.linesIn)],
          ['Lines out', String(result.linesOut)],
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not process those lines.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
