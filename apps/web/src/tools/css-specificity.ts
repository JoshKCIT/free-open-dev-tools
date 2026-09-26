import { meta, computeSpecificity, CssSpecificityError } from '@fodt/css-specificity';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'css-specificity',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'selectors',
      label: 'Selectors',
      type: 'textarea',
      rows: 6,
      mono: true,
      placeholder: '#s12:not(FOO)\n.foo :is(.bar, #baz)',
      help: 'One selector list per line. Separate several selectors on the same line with commas.',
    },
  ],
  examples: [
    { label: 'Selectors Level 4 examples', values: { selectors: '#a, .b, c\n#s12:not(FOO)\n.foo :is(.bar, #baz)' } },
    {
      label: ':is(), :where() and nth-child of',
      values: { selectors: ':is(em, #foo)\n.qux:where(em, #foo#bar#baz)\nli:nth-child(2n+1 of .important)' },
    },
  ],
  run(values): ToolResult {
    const text = str(values, 'selectors');
    if (text.trim() === '') return { outputs: [] };

    let report;
    try {
      report = computeSpecificity(text);
    } catch (err) {
      if (err instanceof CssSpecificityError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      return { outputs: [], errors: [{ message: err instanceof Error ? err.message : String(err) }] };
    }

    if (report.selectors.length === 0) return { outputs: [] };

    const outputs: OutputBlock[] = [
      {
        kind: 'table',
        label: 'Specificity',
        table: {
          headers: ['Selector', 'A', 'B', 'C', 'Specificity'],
          rows: report.selectors.map((s) => [
            s.text,
            s.specificity[0],
            s.specificity[1],
            s.specificity[2],
            s.specificity.join(', '),
          ]),
          mono: [0],
        },
      },
      {
        kind: 'table',
        label: 'What contributes',
        table: {
          headers: ['Selector', 'Part', 'Kind', 'Adds'],
          rows: report.selectors.flatMap((s) =>
            s.parts.length > 0
              ? s.parts.map((p) => [s.text, p.text, p.kind, p.adds.join(', ')])
              : [[s.text, '(none -- only the universal selector)', 'universal selector', '0, 0, 0']],
          ),
          mono: [0, 1],
        },
      },
    ];

    return {
      outputs,
      warnings: report.warnings.length > 0 ? report.warnings : undefined,
      stats: [
        ['Selectors scored', String(report.selectors.length)],
        ['Strongest', report.selectors[0]!.specificity.join(', ')],
      ],
    };
  },
});
