import { meta, formatHtml, HtmlFormatterError } from '@fodt/html-formatter';
import { defineTool, str, bool, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'html-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'HTML',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'beautify',
      options: [
        { value: 'beautify', label: 'Beautify' },
        { value: 'minify', label: 'Minify' },
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
        { value: 'tab', label: 'Tab' },
      ],
      visible: (values) => values.mode !== 'minify',
    },
    {
      name: 'whitespace',
      label: 'Whitespace sensitivity',
      type: 'select',
      default: 'css',
      options: [
        { value: 'css', label: "Follow each element's default CSS display value" },
        { value: 'strict', label: 'Strict: whitespace around every tag matters' },
        { value: 'ignore', label: 'Ignore: whitespace around every tag is insignificant (can change rendering)' },
      ],
      help: "'Ignore' can change how the browser renders whitespace; use it only when that is intended.",
      visible: (values) => values.mode !== 'minify',
    },
    {
      name: 'removeComments',
      label: 'Remove comments',
      type: 'checkbox',
      default: true,
      visible: (values) => values.mode === 'minify',
    },
  ],
  examples: [
    { label: 'Beautify a compact document', values: { input: '<div><p>hi</p></div>', mode: 'beautify' } },
    {
      label: 'Minify a spaced-out document',
      values: { input: '<div>\n  <p>hi</p>\n</div>', mode: 'minify' },
    },
  ],
  async run(values): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const mode = str(values, 'mode', 'beautify') === 'minify' ? 'minify' : 'beautify';
    const indentValue = str(values, 'indent', '2');
    const indent = indentValue === 'tab' ? 'tab' : indentValue === '4' ? 4 : 2;
    const whitespace = str(values, 'whitespace', 'css');

    try {
      const result = await formatHtml(input, {
        mode,
        indent,
        whitespace: whitespace === 'strict' || whitespace === 'ignore' ? whitespace : 'css',
        removeComments: bool(values, 'removeComments', true),
      });

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Output', language: 'html', value: result.output, download: 'formatted.html' },
      ];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Notes', tone: 'warn', value: result.warnings.join('\n') });
      }

      return {
        outputs,
        stats: [
          ['Input', formatBytes(result.inputBytes)],
          ['Output', formatBytes(result.outputBytes)],
        ],
      };
    } catch (err) {
      if (err instanceof HtmlFormatterError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
