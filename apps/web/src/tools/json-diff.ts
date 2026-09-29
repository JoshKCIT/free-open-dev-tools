import {
  meta,
  compareJsonText,
  applyJsonPatchText,
  applyMergePatchText,
  JsonDiffError,
  JsonPatchError,
  type DiffChange,
} from '@fodt/json-diff';
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
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'compare',
      options: [
        { value: 'compare', label: 'Compare' },
        { value: 'apply-json-patch', label: 'Apply JSON Patch' },
        { value: 'apply-merge-patch', label: 'Apply Merge Patch' },
      ],
    },
    {
      name: 'first',
      label: 'First document (before)',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      visible: (v) => v.mode === 'compare' || v.mode === undefined,
    },
    {
      name: 'second',
      label: 'Second document (after)',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      visible: (v) => v.mode === 'compare' || v.mode === undefined,
    },
    {
      name: 'document',
      label: 'Document',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      visible: (v) => v.mode === 'apply-json-patch' || v.mode === 'apply-merge-patch',
    },
    {
      name: 'patch',
      label: 'Patch',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'A JSON Patch is an array of operations, a Merge Patch is an object shaped like the parts to change.',
      visible: (v) => v.mode === 'apply-json-patch' || v.mode === 'apply-merge-patch',
    },
  ],
  examples: [
    {
      label: 'Added and changed',
      values: { mode: 'compare', first: '{"a":1,"b":[1,2]}', second: '{"a":2,"b":[1,2,3]}' },
    },
    {
      label: 'Identical documents',
      values: { mode: 'compare', first: '{"a":1,"b":2}', second: '{"b":2,"a":1}' },
    },
    {
      label: 'Apply a JSON Patch',
      values: {
        mode: 'apply-json-patch',
        document: '{"a":1,"b":2,"c":3}',
        patch:
          '[{"op":"replace","path":"/a","value":10},{"op":"add","path":"/d","value":4},{"op":"remove","path":"/c"}]',
      },
    },
    {
      label: 'Apply a Merge Patch',
      values: {
        mode: 'apply-merge-patch',
        document:
          '{"title":"Goodbye!","author":{"givenName":"John","familyName":"Doe"},"tags":["example","sample"],"content":"This will be unchanged"}',
        patch: '{"title":"Hello!","phoneNumber":"+01-123-456-7890","author":{"familyName":null},"tags":["example"]}',
      },
    },
  ],
  run(values): ToolResult {
    const mode = str(values, 'mode', 'compare');

    if (mode === 'apply-json-patch') return runApplyJsonPatch(values);
    if (mode === 'apply-merge-patch') return runApplyMergePatch(values);
    return runCompare(values);
  },
});

function runCompare(values: Record<string, unknown>): ToolResult {
  const first = str(values, 'first');
  const second = str(values, 'second');
  if (!first.trim() || !second.trim()) return { outputs: [] };

  try {
    const { diff, jsonPatch, mergePatch } = compareJsonText(first, second);
    const outputs: OutputBlock[] = [];

    if (diff.identical) {
      outputs.push({ kind: 'note', tone: 'success', value: 'The documents are identical.' });
    } else {
      outputs.push({
        kind: 'table',
        label: 'Changes',
        table: {
          headers: ['Change', 'Path', 'Before', 'After'],
          rows: diff.changes.map((change) => [
            KIND_LABEL[change.kind],
            change.path === '' ? '(whole document)' : change.path,
            cell(change.before),
            cell(change.after),
          ]),
          mono: [1, 2, 3],
        },
      });

      outputs.push({
        kind: 'code',
        label: 'JSON Patch (RFC 6902)',
        language: 'json',
        value: JSON.stringify(jsonPatch, null, 2),
        download: 'patch.json',
      });

      if (mergePatch.patch === undefined) {
        outputs.push({
          kind: 'note',
          label: 'Merge Patch (RFC 7386)',
          tone: 'warn',
          value: `A merge patch cannot express this comparison, because a merge patch can only delete a member, never set it to the literal value null. That is needed at: ${mergePatch.warnings.join(', ')}.`,
        });
      } else {
        outputs.push({
          kind: 'code',
          label: 'Merge Patch (RFC 7386)',
          language: 'json',
          value: JSON.stringify(mergePatch.patch, null, 2),
          download: 'merge-patch.json',
        });
      }
    }

    return {
      outputs,
      stats: [
        ['Added', String(diff.stats.added)],
        ['Removed', String(diff.stats.removed)],
        ['Changed', String(diff.stats.changed)],
        ['Patch operations', String(jsonPatch.length)],
      ],
    };
  } catch (err) {
    if (err instanceof JsonDiffError) {
      return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
    }
    const message = err instanceof Error ? err.message : 'Could not compare those documents.';
    return { outputs: [], errors: [{ message }] };
  }
}

function runApplyJsonPatch(values: Record<string, unknown>): ToolResult {
  const document = str(values, 'document');
  const patch = str(values, 'patch');
  if (!document.trim() || !patch.trim()) return { outputs: [] };

  try {
    const { result, operations } = applyJsonPatchText(document, patch);
    return {
      outputs: [
        {
          kind: 'code',
          label: 'Patched document',
          language: 'json',
          value: JSON.stringify(result, null, 2),
          download: 'patched.json',
        },
      ],
      stats: [['Operations applied', String(operations)]],
    };
  } catch (err) {
    if (err instanceof JsonDiffError) {
      return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
    }
    if (err instanceof JsonPatchError) {
      return { outputs: [], errors: [{ message: err.message, path: err.path }] };
    }
    const message = err instanceof Error ? err.message : 'Could not apply that patch.';
    return { outputs: [], errors: [{ message }] };
  }
}

function runApplyMergePatch(values: Record<string, unknown>): ToolResult {
  const document = str(values, 'document');
  const patch = str(values, 'patch');
  if (!document.trim() || !patch.trim()) return { outputs: [] };

  try {
    const result = applyMergePatchText(document, patch);
    return {
      outputs: [
        {
          kind: 'code',
          label: 'Patched document',
          language: 'json',
          value: JSON.stringify(result, null, 2),
          download: 'patched.json',
        },
      ],
    };
  } catch (err) {
    if (err instanceof JsonDiffError) {
      return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
    }
    const message = err instanceof Error ? err.message : 'Could not apply that merge patch.';
    return { outputs: [], errors: [{ message }] };
  }
}
