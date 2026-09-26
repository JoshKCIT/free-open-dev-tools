import { meta, convertLength, CssUnitError, UNITS, type Unit } from '@fodt/css-unit';
import { defineTool, str, num, type ToolResult } from '../lib/tool-ui';

const UNIT_LABELS: Record<Unit, string> = {
  px: 'px',
  rem: 'rem',
  em: 'em',
  pt: 'pt',
  pc: 'pc',
  in: 'in',
  cm: 'cm',
  mm: 'mm',
  vw: 'vw',
  vh: 'vh',
  percent: '%',
};

/** Rounds to `precision` decimal places and trims trailing zeros and the point, never an exponent. */
function formatValue(value: number, precision: number): string {
  if (!Number.isFinite(value)) return String(value);
  const fixed = value.toFixed(Math.max(0, Math.min(20, precision)));
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

function cssText(value: number, unit: Unit, precision: number): string {
  return `${formatValue(value, precision)}${UNIT_LABELS[unit]}`;
}

export default defineTool({
  id: 'css-unit',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'value', label: 'Value', type: 'number', default: 16, step: 0.1 },
    {
      name: 'from',
      label: 'Unit',
      type: 'select',
      default: 'px',
      options: UNITS.map((u) => ({ value: u.unit, label: UNIT_LABELS[u.unit] })),
    },
    { name: 'rootFontSize', label: 'Root font size (px)', type: 'number', default: 16, min: 1, max: 1000 },
    { name: 'parentFontSize', label: 'Parent font size (px)', type: 'number', default: 16, min: 1, max: 1000 },
    { name: 'viewportWidth', label: 'Viewport width (px)', type: 'number', default: 1440, min: 1, max: 100000 },
    { name: 'viewportHeight', label: 'Viewport height (px)', type: 'number', default: 900, min: 1, max: 100000 },
    {
      name: 'percentOf',
      label: 'Percent is relative to',
      type: 'select',
      default: 'parent-font-size',
      options: [
        { value: 'parent-font-size', label: 'Parent font size' },
        { value: 'container-width', label: 'Container width' },
      ],
    },
    {
      name: 'containerWidth',
      label: 'Container width (px)',
      type: 'number',
      default: 600,
      min: 1,
      max: 100000,
      visible: (v) => v.percentOf === 'container-width',
    },
    {
      name: 'precision',
      label: 'Precision',
      type: 'select',
      default: '4',
      options: [0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) })),
    },
  ],
  examples: [
    { label: '1 inch, the spec worked example', values: { value: 1, from: 'in' } },
    { label: '1.5rem with a 16px root', values: { value: 1.5, from: 'rem', rootFontSize: 16 } },
    { label: '10vw on a 1440px viewport', values: { value: 10, from: 'vw', viewportWidth: 1440 } },
  ],
  run(values): ToolResult {
    const value = num(values, 'value', 16);
    const from = str(values, 'from', 'px') as Unit;
    const precision = num(values, 'precision', 4);
    const percentOf = str(values, 'percentOf', 'parent-font-size') as 'parent-font-size' | 'container-width';

    let result;
    try {
      result = convertLength(value, from, {
        rootFontSize: num(values, 'rootFontSize', 16),
        parentFontSize: num(values, 'parentFontSize', 16),
        viewportWidth: num(values, 'viewportWidth', 1440),
        viewportHeight: num(values, 'viewportHeight', 900),
        percentOf,
        containerWidth: num(values, 'containerWidth', 600),
      });
    } catch (err) {
      if (err instanceof CssUnitError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      throw err;
    }

    return {
      outputs: [
        {
          kind: 'table',
          label: 'Conversions',
          table: {
            headers: ['Unit', 'Value', 'CSS'],
            rows: result.results.map((r) => [
              UNIT_LABELS[r.unit],
              formatValue(r.value, precision),
              cssText(r.value, r.unit, precision),
            ]),
            mono: [1, 2],
          },
        },
        {
          kind: 'keyvalue',
          label: 'Assumed context',
          pairs: [
            ['Root font size', `${result.context.rootFontSize}px`],
            ['Parent font size', `${result.context.parentFontSize}px`],
            ['Viewport', `${result.context.viewportWidth}px by ${result.context.viewportHeight}px`],
            [
              'Percent is relative to',
              result.context.percentOf === 'container-width'
                ? `the container width (${result.context.containerWidth}px)`
                : 'the parent font size',
            ],
          ],
        },
      ],
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
    };
  },
});
