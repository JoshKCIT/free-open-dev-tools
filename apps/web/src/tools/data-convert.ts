import { meta, convertData, DataConvertError } from '@fodt/data-convert';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const LANGUAGE: Record<string, string | undefined> = { json: 'json', yaml: 'yaml', toml: undefined };

export default defineTool({
  id: 'data-convert',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'from',
      label: 'From',
      type: 'select',
      default: 'json',
      options: [
        { value: 'json', label: 'JSON' },
        { value: 'yaml', label: 'YAML' },
        { value: 'toml', label: 'TOML' },
      ],
    },
    {
      name: 'to',
      label: 'To',
      type: 'select',
      default: 'yaml',
      options: [
        { value: 'json', label: 'JSON' },
        { value: 'yaml', label: 'YAML' },
        { value: 'toml', label: 'TOML' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
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
    },
  ],
  examples: [
    { label: 'JSON to YAML', values: { from: 'json', to: 'yaml', input: '{"name":"Ada","tags":["a","b"]}' } },
    { label: 'YAML to TOML', values: { from: 'yaml', to: 'toml', input: 'name: Ada\ntags:\n  - a\n  - b\n' } },
    { label: 'TOML to JSON', values: { from: 'toml', to: 'json', input: 'name = "Ada"\n' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const from = str(values, 'from', 'json') as 'json' | 'yaml' | 'toml';
    const to = str(values, 'to', 'yaml') as 'json' | 'yaml' | 'toml';
    const indent = Number(str(values, 'indent', '2')) === 4 ? 4 : 2;

    try {
      const result = convertData(input, { from, to, indent });
      const outputs: OutputBlock[] = [{ kind: 'code', label: 'Output', language: LANGUAGE[to], value: result.output }];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }
      return {
        outputs,
        stats: [
          ['Input bytes', String(new TextEncoder().encode(input).length)],
          ['Output bytes', String(new TextEncoder().encode(result.output).length)],
        ],
      };
    } catch (err) {
      if (err instanceof DataConvertError) {
        return {
          outputs: [],
          errors: [{ message: err.message, line: err.line, column: err.column, path: err.path }],
        };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
