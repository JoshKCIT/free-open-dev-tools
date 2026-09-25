import { meta, convertToJsx, JsxConverterError } from '@fodt/jsx-converter';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'jsx-converter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'HTML or SVG',
      type: 'textarea',
      rows: 14,
      placeholder: 'Paste markup here. Nothing leaves your browser.',
    },
    {
      name: 'output',
      label: 'Output',
      type: 'radio',
      default: 'jsx',
      options: [
        { value: 'jsx', label: 'JSX only' },
        { value: 'component', label: 'Function component' },
        { value: 'typescript', label: 'Typed component' },
      ],
    },
    {
      name: 'componentName',
      label: 'Component name',
      type: 'text',
      default: 'Markup',
      visible: (values) => str(values, 'output', 'jsx') !== 'jsx',
    },
    {
      name: 'defaultValues',
      label: 'Rewrite value/checked to defaultValue/defaultChecked',
      type: 'checkbox',
      default: true,
    },
  ],
  examples: [
    {
      label: 'Label with a class and a for attribute',
      values: { input: '<label for="x" class="y">A</label>' },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    try {
      const result = convertToJsx(input, {
        output: str(values, 'output', 'jsx') as 'jsx' | 'component' | 'typescript',
        componentName: str(values, 'componentName', 'Markup'),
        defaultValues: bool(values, 'defaultValues', true),
      });

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'JSX',
          language: str(values, 'output', 'jsx') === 'typescript' ? 'tsx' : 'jsx',
          value: result.output,
          download: str(values, 'output', 'jsx') === 'typescript' ? 'Markup.tsx' : 'Markup.jsx',
        },
      ];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }
      return { outputs };
    } catch (err) {
      if (err instanceof JsxConverterError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
