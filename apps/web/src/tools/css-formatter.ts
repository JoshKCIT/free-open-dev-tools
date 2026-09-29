import { meta, formatCss, CssFormatterError } from '@fodt/css-formatter';
import { defineTool, str, bool, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'css-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'CSS, SCSS or Less',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'syntax',
      label: 'Syntax',
      type: 'radio',
      default: 'css',
      options: [
        { value: 'css', label: 'CSS' },
        { value: 'scss', label: 'SCSS' },
        { value: 'less', label: 'Less' },
      ],
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
    {
      label: 'Beautify SCSS with nesting and a mixin',
      values: {
        input:
          '@mixin theme($color) {\n  background: $color;\n}\n.a {\n  &:hover {\n    @include theme(DarkRed);\n  }\n}\n',
        syntax: 'scss',
        mode: 'beautify',
      },
    },
  ],
  async run(values): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const syntaxValue = str(values, 'syntax', 'css');
    const syntax = syntaxValue === 'scss' || syntaxValue === 'less' ? syntaxValue : 'css';
    const mode = str(values, 'mode', 'beautify') === 'minify' ? 'minify' : 'beautify';
    const indentValue = str(values, 'indent', '2');
    const indent = indentValue === 'tab' ? 'tab' : indentValue === '4' ? 4 : 2;

    try {
      const result = await formatCss(input, {
        mode,
        syntax,
        indent,
        restructure: bool(values, 'restructure', true),
        keepLicenceComments: bool(values, 'keepLicenceComments', true),
      });

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Output',
          language: syntax,
          value: result.output,
          download: mode === 'beautify' ? `formatted.${syntax}` : 'styles.min.css',
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
