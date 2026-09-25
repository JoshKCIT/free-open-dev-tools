import { meta, optimizeSvg, SvgOptimizerError } from '@fodt/svg-optimizer';
import { defineTool, str, bool, num, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'svg-optimizer',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'SVG',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    { name: 'multipass', label: 'Multipass (optimise until nothing more changes)', type: 'checkbox', default: true },
    { name: 'precision', label: 'Precision (decimal places)', type: 'number', default: 3, min: 0, max: 8 },
    { name: 'pretty', label: 'Pretty-print output', type: 'checkbox', default: false },
  ],
  examples: [
    {
      label: 'A rectangle with a hostile script stripped',
      values: {
        input:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10" fill="#00aa00"/></svg>',
      },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const precisionInput = num(values, 'precision', 3);
    const precision = Math.max(0, Math.trunc(precisionInput));

    try {
      const result = optimizeSvg(input, window, {
        multipass: bool(values, 'multipass', true),
        precision,
        pretty: bool(values, 'pretty', false),
      });

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Optimised SVG', language: 'xml', value: result.output, download: 'optimised.svg' },
        { kind: 'sandboxed-html', label: 'Preview', html: result.output },
      ];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Notes', tone: 'warn', value: result.warnings.join('\n') });
      }

      const saved = result.originalBytes - result.optimisedBytes;
      const savedPercent = result.originalBytes > 0 ? Math.round((saved / result.originalBytes) * 100) : 0;
      return {
        outputs,
        stats: [
          ['Original', formatBytes(result.originalBytes)],
          ['Optimised', formatBytes(result.optimisedBytes)],
          ['Saved', `${formatBytes(Math.max(0, saved))} (${savedPercent}%)`],
        ],
      };
    } catch (err) {
      if (err instanceof SvgOptimizerError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
