import { meta, findReplace, FindReplaceError } from '@fodt/find-replace';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'find-replace',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Text',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    { name: 'find', label: 'Find', type: 'textarea', rows: 2, mono: true },
    { name: 'replacement', label: 'Replace with', type: 'textarea', rows: 2, mono: true },
    { name: 'caseSensitive', label: 'Case sensitive', type: 'checkbox', default: true },
    { name: 'wholeWord', label: 'Whole word', type: 'checkbox', default: false },
    { name: 'multiline', label: 'Multiline (find text can span a line break)', type: 'checkbox', default: false },
  ],
  examples: [
    {
      label: 'Whole word',
      values: { input: 'The cat sat on the concatenated mat.', find: 'cat', replacement: 'dog', wholeWord: true },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    try {
      const result = findReplace(input, str(values, 'find'), str(values, 'replacement'), {
        caseSensitive: bool(values, 'caseSensitive', true),
        wholeWord: bool(values, 'wholeWord'),
        multiline: bool(values, 'multiline'),
      });

      const outputs: OutputBlock[] = [{ kind: 'code', value: result.output }];
      return { outputs, stats: [['Replacements', String(result.count)]] };
    } catch (err) {
      const message = err instanceof FindReplaceError ? err.message : 'Could not process that find and replace.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
