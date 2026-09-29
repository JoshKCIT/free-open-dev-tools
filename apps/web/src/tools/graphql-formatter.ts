import { meta, formatGraphql, GraphqlFormatterError } from '@fodt/graphql-formatter';
import { defineTool, str, num, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'graphql-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'GraphQL',
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
      name: 'printWidth',
      label: 'Print width',
      type: 'number',
      default: 80,
      min: 20,
      max: 200,
      step: 1,
      visible: (values) => values.mode !== 'minify',
    },
  ],
  examples: [
    {
      label: 'Beautify a compact query',
      values: { input: 'query Hero($episode:Episode){hero(episode:$episode){name friends{name}}}', mode: 'beautify' },
    },
    {
      label: 'Minify a schema with a description and a comment',
      values: {
        input: '"""A person."""\ntype Person {\n  # their name\n  name: String\n}\n',
        mode: 'minify',
      },
    },
  ],
  async run(values): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const mode = str(values, 'mode', 'beautify') === 'minify' ? 'minify' : 'beautify';
    const indentValue = str(values, 'indent', '2');
    const indent = indentValue === 'tab' ? 'tab' : indentValue === '4' ? 4 : 2;

    try {
      const result = await formatGraphql(input, {
        mode,
        indent,
        printWidth: num(values, 'printWidth', 80),
      });

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Output',
          language: 'graphql',
          value: result.output,
          download: mode === 'beautify' ? 'formatted.graphql' : 'query.min.graphql',
        },
      ];

      return {
        outputs,
        stats: [
          ['Input', formatBytes(result.inputBytes)],
          ['Output', formatBytes(result.outputBytes)],
          ['Operations', String(result.stats.operations)],
          ['Fragments', String(result.stats.fragments)],
          ['Type definitions', String(result.stats.typeDefinitions)],
        ],
      };
    } catch (err) {
      if (err instanceof GraphqlFormatterError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
