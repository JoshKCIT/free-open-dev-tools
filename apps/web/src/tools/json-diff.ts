import { meta, diffJsonText, JsonDiffError, type DiffChange } from '@fodt/json-diff';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const KIND_LABEL: Record<DiffChange['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
};

/** Compact JSON for a table cell; long values are cut with an ellipsis. */
function cell(value: unknown): string {
  if (value === undefined) return '';
  const text = JSON.stringify(value);
  return text.length > 200 ? text.slice(0, 200) + '...' : text;
}

export default defineTool({
  id: 'json-diff',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'first',
      label: 'First document (before)',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'second',
      label: 'Second document (after)',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
  ],
  examples: [
    {
      label: 'Added and changed',
      values: { first: '{"a":1,"b":[1,2]}', second: '{"a":2,"b":[1,2,3]}' },
    },
    {
      label: 'Identical documents',
      values: { first: '{"a":1,"b":2}', second: '{"b":2,"a":1}' },
    },
  ],
  run(values): ToolResult {
    const first = str(values, 'first');
    const second = str(values, 'second');
    if (!first.trim() || !second.trim()) return { outputs: [] };

    try {
      const result = diffJsonText(first, second);
      const outputs: OutputBlock[] = [];

      if (result.identical) {
        outputs.push({ kind: 'note', tone: 'success', value: 'The documents are identical.' });
      } else {
        outputs.push({
          kind: 'table',
          label: 'Changes',
          table: {
            headers: ['Change', 'Path', 'Before', 'After'],
            rows: result.changes.map((change) => [
              KIND_LABEL[change.kind],
              change.path === '' ? '(whole document)' : change.path,
              cell(change.before),
              cell(change.after),
            ]),
            mono: [1, 2, 3],
          },
        });
      }

      return {
        outputs,
        stats: [
          ['Added', String(result.stats.added)],
          ['Removed', String(result.stats.removed)],
          ['Changed', String(result.stats.changed)],
        ],
      };
    } catch (err) {
      if (err instanceof JsonDiffError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not compare those documents.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
