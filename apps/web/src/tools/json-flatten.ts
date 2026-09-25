import { meta, flattenText, unflattenText, FlattenError } from '@fodt/json-flatten';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'json-flatten',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Direction',
      type: 'radio',
      default: 'flatten',
      options: [
        { value: 'flatten', label: 'Flatten JSON to a pointer map' },
        { value: 'unflatten', label: 'Rebuild JSON from a pointer map' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
  ],
  examples: [
    { label: 'Flatten', values: { mode: 'flatten', input: '{"user":{"name":"Ada","tags":["a","b"]}}' } },
    { label: 'Unflatten', values: { mode: 'unflatten', input: '{"/user/name":"Ada","/user/tags/0":"a"}' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const mode = str(values, 'mode', 'flatten');
    try {
      const result = mode === 'unflatten' ? unflattenText(input) : flattenText(input);
      const outputs: OutputBlock[] = [{ kind: 'code', label: 'Output', language: 'json', value: result.output }];
      return {
        outputs,
        stats: [
          ['Leaves', String(result.leaves)],
          ['Deepest level', String(result.maxDepth)],
        ],
      };
    } catch (err) {
      if (err instanceof FlattenError) {
        return {
          outputs: [],
          errors: [{ message: err.message, line: err.line, column: err.column, path: err.path }],
        };
      }
      const message = err instanceof Error ? err.message : 'Could not process that document.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
