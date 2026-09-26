import { translateEslintConfig, EslintToBiomeError, BIOME_VERSION, meta } from '@fodt/eslint-to-biome';
import { bool, defineTool, str, type ToolResult } from '../lib/tool-ui';

const EXAMPLE = `{
  "rules": {
    "no-debugger": "error",
    "eqeqeq": ["error", "always"],
    "indent": ["error", 2]
  }
}`;

export default defineTool({
  id: 'eslint-to-biome',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'ESLint configuration',
      type: 'textarea',
      rows: 16,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'format',
      label: 'Format',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Detect automatically' },
        { value: 'json', label: 'JSON or .eslintrc' },
        { value: 'yaml', label: 'YAML' },
        { value: 'flat', label: 'Flat config (eslint.config.js)' },
      ],
    },
    { name: 'includeNursery', label: 'Include Biome nursery rules', type: 'checkbox', default: false },
    { name: 'includeInspired', label: 'Include rules inspired by another tool', type: 'checkbox', default: false },
  ],
  examples: [{ label: 'no-debugger, eqeqeq and indent', values: { input: EXAMPLE, format: 'json' } }],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const format = str(values, 'format', 'auto') as 'auto' | 'json' | 'yaml' | 'flat';
    const includeNursery = bool(values, 'includeNursery', false);
    const includeInspired = bool(values, 'includeInspired', false);

    try {
      const result = translateEslintConfig(input, { format, includeNursery, includeInspired });

      const outputs: ToolResult['outputs'] = [
        { kind: 'code', label: 'biome.json', language: 'json', value: result.output, download: 'biome.json' },
        { kind: 'note', tone: 'info', value: `Mapped against Biome ${BIOME_VERSION.replace('@biomejs/biome@', '')}.` },
      ];

      if (result.mapped.length > 0) {
        outputs.push({
          kind: 'table',
          label: 'Mapped',
          table: {
            headers: ['ESLint rule', 'Biome rule', 'Level'],
            rows: result.mapped.map((m) => [m.eslint, m.biome, m.level]),
          },
        });
      }

      if (result.unmapped.length > 0) {
        outputs.push({
          kind: 'table',
          label: 'Not mapped',
          table: {
            headers: ['ESLint rule', 'Reason'],
            rows: result.unmapped.map((u) => [u.eslint, u.reason]),
          },
        });
      }

      if (result.notCarried.length > 0) {
        outputs.push({ kind: 'list', label: 'Not carried over', items: result.notCarried });
      }

      const errors = result.couldNotRead.map((c) => ({
        message: `Could not read statically: ${c.what}.`,
        line: c.line,
        column: c.column,
      }));

      return {
        outputs,
        errors,
        stats: [
          ['Mapped', String(result.mapped.length)],
          ['Not mapped', String(result.unmapped.length)],
        ],
      };
    } catch (err) {
      if (err instanceof EslintToBiomeError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'This configuration could not be translated.' }],
      };
    }
  },
});
