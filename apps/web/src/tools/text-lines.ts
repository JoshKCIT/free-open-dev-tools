import { meta, processLines, ALL_OPERATIONS, type LineOperation } from '@fodt/text-lines';
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
  affix: 'Add prefix or suffix',
  reverse: 'Reverse order',
  'tabs-to-spaces': 'Tabs to spaces',
  'spaces-to-tabs': 'Spaces to tabs',
  wrap: 'Wrap lines',
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
      options: ALL_OPERATIONS.map((op) => ({ value: op, label: OPERATION_LABELS[op] })),
    },
    {
      name: 'order',
      label: 'Sort order',
      type: 'select',
      default: 'codepoint',
      options: [
        { value: 'codepoint', label: 'Code point' },
        { value: 'natural', label: 'Natural (line 2 before line 10)' },
        { value: 'length', label: 'Length in characters' },
        { value: 'ip', label: 'As IP addresses' },
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
    {
      name: 'prefix',
      label: 'Prefix',
      type: 'text',
      default: '',
      visible: (values) => isOp(values, 'affix'),
    },
    {
      name: 'suffix',
      label: 'Suffix',
      type: 'text',
      default: '',
      visible: (values) => isOp(values, 'affix'),
    },
    {
      name: 'skipBlank',
      label: 'Skip blank lines',
      type: 'checkbox',
      default: false,
      visible: (values) => isOp(values, 'affix'),
    },
    {
      name: 'tabWidth',
      label: 'Tab width',
      type: 'number',
      default: 4,
      min: 1,
      max: 16,
      help: 'Columns between tab stops, from 1 to 16.',
      visible: (values) => isOp(values, 'tabs-to-spaces') || isOp(values, 'spaces-to-tabs'),
    },
    {
      name: 'allRuns',
      label: 'Convert inner runs too',
      type: 'checkbox',
      default: false,
      visible: (values) => isOp(values, 'spaces-to-tabs'),
    },
    {
      name: 'wrapWidth',
      label: 'Width',
      type: 'number',
      default: 80,
      min: 1,
      max: 1000,
      help: 'Wrap at this many characters, from 1 to 1000.',
      visible: (values) => isOp(values, 'wrap'),
    },
    {
      name: 'breakLongWords',
      label: 'Break long words',
      type: 'checkbox',
      default: false,
      visible: (values) => isOp(values, 'wrap'),
    },
  ],
  examples: [
    { label: 'Sort', values: { input: 'banana\napple\ncherry', operation: 'sort' } },
    { label: 'Natural order', values: { input: 'line 10\nline 2\nline 1', operation: 'sort', order: 'natural' } },
    { label: 'Add a prefix', values: { input: 'apple\nbanana\ncherry', operation: 'affix', prefix: '- ' } },
    {
      label: 'Sort IP addresses',
      values: { input: '10.0.0.10\n::1\n10.0.0.2', operation: 'sort', order: 'ip' },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    const operation = str(values, 'operation', 'sort') as LineOperation;
    try {
      const result = processLines(input, operation, {
        order: str(values, 'order', 'codepoint') as 'codepoint' | 'natural' | 'length' | 'ip',
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
        prefix: str(values, 'prefix', ''),
        suffix: str(values, 'suffix', ''),
        skipBlank: bool(values, 'skipBlank'),
        tabWidth: num(values, 'tabWidth', 4),
        allRuns: bool(values, 'allRuns'),
        wrapWidth: num(values, 'wrapWidth', 80),
        breakLongWords: bool(values, 'breakLongWords'),
      });

      const outputs: OutputBlock[] = [{ kind: 'code', value: result.output }];
      if (result.nonAddressLines !== undefined && result.nonAddressLines > 0) {
        outputs.push({
          kind: 'note',
          label: 'Not IP addresses',
          tone: 'info',
          value: `${result.nonAddressLines} of ${result.linesIn} lines were not IP addresses, so they follow the sorted addresses in their original order.`,
        });
      }
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
