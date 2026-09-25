import { meta, formatXml, XmlFormatterError, type FormatMode } from '@fodt/xml-formatter';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'xml-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'format',
      options: [
        { value: 'format', label: 'Format' },
        { value: 'minify', label: 'Minify' },
        { value: 'check', label: 'Check' },
      ],
    },
    {
      name: 'indent',
      label: 'Indent',
      type: 'select',
      default: '2',
      options: [
        { value: '2', label: '2 spaces' },
        { value: '4', label: '4 spaces' },
      ],
      visible: (values) => str(values, 'mode', 'format') === 'format',
    },
    {
      name: 'removeComments',
      label: 'Remove comments',
      type: 'checkbox',
      default: false,
      visible: (values) => str(values, 'mode', 'format') === 'minify',
    },
  ],
  examples: [
    {
      label: 'Format',
      values: { mode: 'format', input: '<note><to>Ada</to><body>Hello</body></note>' },
    },
    {
      label: 'Check',
      values: { mode: 'check', input: '<note><to>Ada</to></note>' },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const mode = str(values, 'mode', 'format') as FormatMode;
    const indent = num(values, 'indent', 2);
    const removeComments = bool(values, 'removeComments', false);

    try {
      const result = formatXml(input, { mode, indent, removeComments });
      const outputs: OutputBlock[] = [{ kind: 'code', label: 'Output', language: 'xml', value: result.output }];
      if (mode === 'check') {
        outputs.unshift({ kind: 'note', tone: 'success', value: 'Well-formed XML 1.0.' });
      }
      return {
        outputs,
        stats: [
          ['Elements', String(result.elements)],
          ['Attributes', String(result.attributes)],
          ['Deepest level', String(result.maxDepth)],
        ],
      };
    } catch (err) {
      if (err instanceof XmlFormatterError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
