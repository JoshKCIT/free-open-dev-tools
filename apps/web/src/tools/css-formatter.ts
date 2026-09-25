import { meta, formatCss, CssFormatterError } from '@fodt/css-formatter';
import { defineTool, str, bool, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'css-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'CSS',
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
      name: 'restructure',
      label: 'Restructure (merge and reorder rules where safe)',
      type: 'checkbox',
      default: true,
      visible: (values) => values.mode === 'minify',
    },
    {
      name: 'keepLicenceComments',
      label: 'Keep licence comments (/*! ... */)',
      type: 'checkbox',
      default: true,
      visible: (values) => values.mode === 'minify',
    },
  ],
  examples: [
    { label: 'Beautify a compact rule', values: { input: 'a{color:red}', mode: 'beautify' } },
    { label: 'Minify a spaced-out rule', values: { input: '.test { color: #ff0000; }', mode: 'minify' } },
  ],
  async run(values): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const mode = str(values, 'mode', 'beautify') === 'minify' ? 'minify' : 'beautify';
    const indentValue = str(values, 'indent', '2');
    const indent = indentValue === 'tab' ? 'tab' : indentValue === '4' ? 4 : 2;

    try {
      const result = await formatCss(input, {
        mode,
        indent,
        restructure: bool(values, 'restructure', true),
        keepLicenceComments: bool(values, 'keepLicenceComments', true),
      });

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Output',
          language: 'css',
          value: result.output,
          download: mode === 'beautify' ? 'formatted.css' : 'styles.min.css',
        },
      ];

      return {
        outputs,
        stats: [
          ['Input', formatBytes(result.inputBytes)],
          ['Output', formatBytes(result.outputBytes)],
        ],
      };
    } catch (err) {
      if (err instanceof CssFormatterError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
