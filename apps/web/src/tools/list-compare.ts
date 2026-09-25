import { meta, compareLists } from '@fodt/list-compare';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'list-compare',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'listA',
      label: 'List A',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'listB',
      label: 'List B',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    { name: 'trim', label: 'Trim whitespace', type: 'checkbox', default: true },
    { name: 'ignoreCase', label: 'Ignore case', type: 'checkbox', default: false },
    { name: 'keepBlank', label: 'Keep blank lines', type: 'checkbox', default: false },
    { name: 'normalize', label: 'Unicode normalise (NFC)', type: 'checkbox', default: false },
  ],
  examples: [
    {
      label: 'Union and difference',
      values: { listA: 'apple\nbanana\ncherry', listB: 'banana\ncherry\ndate' },
    },
  ],
  run(values): ToolResult {
    const listA = str(values, 'listA');
    const listB = str(values, 'listB');
    if (!listA.trim() && !listB.trim()) return { outputs: [] };

    const result = compareLists(listA, listB, {
      trim: bool(values, 'trim', true),
      ignoreCase: bool(values, 'ignoreCase'),
      keepBlank: bool(values, 'keepBlank'),
      normalize: bool(values, 'normalize'),
    });

    const outputs: OutputBlock[] = [
      { kind: 'list', label: `In both (${result.counts.intersection})`, items: result.intersection },
      { kind: 'list', label: `Only in A (${result.counts.onlyA})`, items: result.onlyA },
      { kind: 'list', label: `Only in B (${result.counts.onlyB})`, items: result.onlyB },
      { kind: 'list', label: `In either (${result.counts.union})`, items: result.union },
      { kind: 'list', label: `In exactly one (${result.counts.symmetric})`, items: result.symmetric },
    ];

    return {
      outputs,
      stats: [
        ['Items in A', String(result.counts.intersection + result.counts.onlyA)],
        ['Items in B', String(result.counts.intersection + result.counts.onlyB)],
        ['Duplicates collapsed', String(result.counts.duplicatesA + result.counts.duplicatesB)],
      ],
    };
  },
});
