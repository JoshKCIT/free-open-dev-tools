import { meta, unserializePhp, PhpUnserializeError } from '@fodt/php-unserialize';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'php-unserialize',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Serialized PHP value',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'sequentialArrays',
      label: 'Turn arrays keyed 0, 1, 2 into JSON arrays',
      type: 'checkbox',
      default: true,
    },
  ],
  examples: [
    {
      label: 'Array of strings',
      values: { input: 'a:2:{i:0;s:5:"apple";i:1;s:6:"banana";}' },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };
    const sequentialArrays = bool(values, 'sequentialArrays', true);

    try {
      const result = unserializePhp(input, { sequentialArrays });
      return {
        outputs: [
          { kind: 'code', label: 'JSON', language: 'json', value: JSON.stringify(result.value, null, 2) },
          ...(result.warnings.length > 0 ? [{ kind: 'list' as const, label: 'Warnings', items: result.warnings }] : []),
        ],
        stats: [
          ['Values decoded', String(result.stats.valueCount)],
          ['Deepest level', String(result.stats.maxDepth)],
        ],
      };
    } catch (err) {
      if (err instanceof PhpUnserializeError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'This value could not be decoded.' }],
      };
    }
  },
});
