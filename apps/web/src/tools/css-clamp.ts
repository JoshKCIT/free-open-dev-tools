import { meta, fluidClamp, evaluateClamp, CssClampError, type ClampUnit } from '@fodt/css-clamp';
import { defineTool, num, str, type ToolResult } from '../lib/tool-ui';

const COMMON_WIDTHS = [320, 375, 768, 1024, 1280, 1440, 1920];

function formatPx(value: number, precision: number): string {
  return `${value
    .toFixed(Math.max(0, Math.min(10, precision)))
    .replace(/0+$/, '')
    .replace(/\.$/, '')}px`;
}

export default defineTool({
  id: 'css-clamp',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'minSize', label: 'Minimum size (px)', type: 'number', default: 16, min: 1, max: 1000 },
    { name: 'maxSize', label: 'Maximum size (px)', type: 'number', default: 24, min: 1, max: 1000 },
    { name: 'minViewport', label: 'Minimum viewport (px)', type: 'number', default: 320, min: 1, max: 100000 },
    { name: 'maxViewport', label: 'Maximum viewport (px)', type: 'number', default: 1280, min: 1, max: 100000 },
    { name: 'rootFontSize', label: 'Root font size (px)', type: 'number', default: 16, min: 1, max: 1000 },
    {
      name: 'unit',
      label: 'Output unit',
      type: 'radio',
      default: 'rem',
      options: [
        { value: 'rem', label: 'rem' },
        { value: 'px', label: 'px' },
      ],
    },
    {
      name: 'precision',
      label: 'Precision',
      type: 'select',
      default: '4',
      options: [2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) })),
    },
  ],
  examples: [
    { label: 'Body copy, 320 to 1280', values: { minSize: 16, maxSize: 24, minViewport: 320, maxViewport: 1280 } },
    { label: 'Hero heading, wide range', values: { minSize: 32, maxSize: 72, minViewport: 400, maxViewport: 1600 } },
  ],
  run(values): ToolResult {
    const precision = num(values, 'precision', 4);
    const unit = str(values, 'unit', 'rem') as ClampUnit;

    let result;
    try {
      result = fluidClamp({
        minSize: num(values, 'minSize', 16),
        maxSize: num(values, 'maxSize', 24),
        minViewport: num(values, 'minViewport', 320),
        maxViewport: num(values, 'maxViewport', 1280),
        rootFontSize: num(values, 'rootFontSize', 16),
        unit,
        precision,
      });
    } catch (err) {
      if (err instanceof CssClampError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      throw err;
    }

    const widths = Array.from(new Set([...COMMON_WIDTHS, result.minViewport, result.maxViewport])).sort(
      (a, b) => a - b,
    );

    return {
      outputs: [
        { kind: 'code', label: 'CSS', language: 'css', value: result.declaration, download: 'clamp.css' },
        {
          kind: 'table',
          label: 'Size at common widths',
          table: {
            headers: ['Viewport', 'Size'],
            rows: widths.map((w) => [`${w}px`, formatPx(evaluateClamp(result, w), 2)]),
            mono: [0, 1],
          },
        },
        {
          kind: 'keyvalue',
          label: 'Slope and intercept',
          pairs: [
            ['Slope', result.slope.toFixed(6)],
            ['Intercept (px)', result.intercept.toFixed(4)],
          ],
        },
      ],
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
    };
  },
});
