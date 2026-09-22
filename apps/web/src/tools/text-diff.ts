import { meta, diffText, unifiedDiff, sideBySide, invisibleDifferences, type Granularity } from '@fodt/text-diff';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'text-diff',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'left', label: 'Original', type: 'textarea', rows: 10, placeholder: 'Paste the first version here' },
    { name: 'right', label: 'Changed', type: 'textarea', rows: 10, placeholder: 'Paste the second version here' },
    {
      name: 'granularity',
      label: 'Compare by',
      type: 'radio',
      default: 'line',
      options: [
        { value: 'line', label: 'Line' },
        { value: 'word', label: 'Word' },
        { value: 'character', label: 'Character' },
      ],
    },
    { name: 'ignoreCase', label: 'Ignore case', type: 'checkbox', default: false },
    { name: 'ignoreWhitespace', label: 'Ignore whitespace differences', type: 'checkbox', default: false },
    {
      name: 'sortLines',
      label: 'Sort lines before comparing (for unordered lists)',
      type: 'checkbox',
      default: false,
      visible: (v) => v.granularity === 'line',
    },
    {
      name: 'normaliseLineEndings',
      label: 'Treat CRLF and LF as the same',
      type: 'checkbox',
      default: true,
    },
    {
      name: 'context',
      label: 'Context lines in the unified diff',
      type: 'number',
      default: 3,
      min: 0,
      max: 20,
      visible: (v) => v.granularity === 'line',
    },
  ],
  examples: [
    {
      label: 'Changed line',
      values: { left: 'alpha\nbravo\ncharlie\ndelta', right: 'alpha\nBRAVO\ncharlie\ndelta\necho' },
    },
    {
      label: 'Looks identical',
      values: { left: 'config: true\r\nvalue: 1', right: 'config: true\nvalue: 1 ', normaliseLineEndings: false },
    },
  ],
  run(values): ToolResult {
    const left = str(values, 'left');
    const right = str(values, 'right');
    if (!left && !right) return { outputs: [] };

    const granularity = str(values, 'granularity', 'line') as Granularity;
    const options = {
      granularity,
      ignoreCase: bool(values, 'ignoreCase'),
      ignoreWhitespace: bool(values, 'ignoreWhitespace'),
      sortLines: bool(values, 'sortLines'),
      normaliseLineEndings: bool(values, 'normaliseLineEndings', true),
    };

    const result = diffText(left, right, options);
    const outputs: OutputBlock[] = [];

    if (result.identical) {
      outputs.push({
        kind: 'note',
        tone: left === right ? 'success' : 'warn',
        value:
          left === right
            ? 'These two are byte-for-byte identical.'
            : 'These match under the options you selected, but they are not byte-for-byte identical.',
      });
    }

    const invisible = invisibleDifferences(left, right);
    if (invisible.length > 0) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: 'Differences you cannot see on screen: ' + invisible.join(' '),
      });
    }

    if (granularity === 'line') {
      const rows = sideBySide(left, right, options);
      outputs.push({
        kind: 'table',
        label: 'Side by side',
        table: {
          headers: ['#', 'Original', '#', 'Changed', ''],
          rows: rows.map((r) => [
            r.leftNumber ?? '',
            r.left ?? '',
            r.rightNumber ?? '',
            r.right ?? '',
            r.op === 'equal' ? '' : r.op === 'changed' ? 'changed' : r.op === 'insert' ? 'added' : 'removed',
          ]),
          mono: [0, 1, 2, 3],
        },
      });

      const patch = unifiedDiff(left, right, { ...options, context: num(values, 'context', 3) });
      if (patch) {
        outputs.push({
          kind: 'diff',
          label: 'Unified diff',
          lines: patch.split('\n').map((line) => ({
            type: line.startsWith('+')
              ? ('add' as const)
              : line.startsWith('-')
                ? ('del' as const)
                : line.startsWith('@@')
                  ? ('meta' as const)
                  : ('ctx' as const),
            text: line,
          })),
        });
        outputs.push({ kind: 'code', label: 'Patch text, for copying', value: patch, download: 'changes.patch' });
      }
    } else {
      outputs.push({
        kind: 'diff',
        label: `Changes by ${granularity}`,
        lines: result.changes.map((c) => ({
          type: c.op === 'insert' ? ('add' as const) : c.op === 'delete' ? ('del' as const) : ('ctx' as const),
          text:
            (c.op === 'insert' ? '+ ' : c.op === 'delete' ? '- ' : '  ') +
            c.values.join(granularity === 'character' ? '' : ''),
        })),
      });
    }

    return {
      outputs,
      stats: [
        ['Added', String(result.stats.added)],
        ['Removed', String(result.stats.removed)],
        ['Unchanged', String(result.stats.unchanged)],
        ['Similarity', `${Math.round(result.stats.similarity * 100)}%`],
      ],
    };
  },
});
