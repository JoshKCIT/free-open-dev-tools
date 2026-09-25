import { meta, analyseComplexity, CodeComplexityError } from '@fodt/code-complexity';
import { defineTool, str, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'code-complexity',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'JavaScript or TypeScript',
      type: 'textarea',
      rows: 16,
      placeholder: 'Paste code here. Nothing leaves your browser.',
    },
    {
      name: 'language',
      label: 'Language',
      type: 'select',
      default: 'javascript',
      options: [
        { value: 'javascript', label: 'JavaScript' },
        { value: 'typescript', label: 'TypeScript' },
        { value: 'tsx', label: 'TypeScript with JSX' },
      ],
    },
    { name: 'threshold', label: 'Threshold', type: 'number', default: 10, min: 1, max: 100, step: 1 },
  ],
  examples: [
    {
      label: 'ESLint complexity documentation: if / else if / else',
      values: {
        input:
          'function a(x) {\n  if (true) {\n    return x;\n  } else if (false) {\n    return x+1;\n  } else {\n    return 4;\n  }\n}',
      },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const threshold = Math.min(100, Math.max(1, Math.round(num(values, 'threshold', 10))));

    try {
      const result = analyseComplexity(input, {
        language: str(values, 'language', 'javascript') as 'javascript' | 'typescript' | 'tsx',
        threshold,
      });

      const sorted = [...result.functions].sort((a, b) => b.complexity - a.complexity);
      const outputs: OutputBlock[] = [
        {
          kind: 'table',
          label: 'Functions',
          table: {
            headers: ['Function', 'Kind', 'Line', 'Complexity', 'Lines', 'Code lines'],
            rows: sorted.map((f) => [f.name, f.kind, f.line, f.complexity, f.lines, f.codeLines]),
            mono: [0],
          },
        },
      ];
      if (result.over.length > 0) {
        outputs.push({
          kind: 'note',
          label: 'Over threshold',
          tone: 'warn',
          value: result.over.map((f) => `${f.name} (line ${f.line}): complexity ${f.complexity}`).join('\n'),
        });
      }

      return {
        outputs,
        stats: [
          ['Functions', String(result.functions.length)],
          ['Highest', String(result.highest)],
          ['Average', result.average.toFixed(1)],
        ],
      };
    } catch (err) {
      if (err instanceof CodeComplexityError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
