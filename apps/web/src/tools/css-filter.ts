import { meta, generateFilter, type ScalarFilterName } from '@fodt/css-filter';
import {
  defineTool,
  point,
  num,
  str,
  type Field,
  type OutputBlock,
  type ToolResult,
  type Values,
} from '../lib/tool-ui';

const FUNCTION_OPTIONS = [
  { value: 'blur', label: 'Blur' },
  { value: 'brightness', label: 'Brightness' },
  { value: 'contrast', label: 'Contrast' },
  { value: 'drop-shadow', label: 'Drop shadow' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'hue-rotate', label: 'Hue rotate' },
  { value: 'invert', label: 'Invert' },
  { value: 'opacity', label: 'Opacity' },
  { value: 'saturate', label: 'Saturate' },
  { value: 'sepia', label: 'Sepia' },
];
const COUNT_OPTIONS = ['1', '2', '3', '4'].map((v) => ({ value: v, label: v }));

const AMOUNT_HELP: Record<string, string> = {
  blur: 'Standard deviation in pixels. 0 has no effect.',
  brightness: 'Percent. 100 leaves the image unchanged.',
  contrast: 'Percent. 100 leaves the image unchanged.',
  grayscale: 'Percent. 100 is fully grey.',
  'hue-rotate': 'Degrees around the colour wheel. 0 has no effect.',
  invert: 'Percent. 100 is fully inverted.',
  opacity: 'Percent. 100 leaves the image unchanged.',
  saturate: 'Percent. 100 leaves the image unchanged.',
  sepia: 'Percent. 100 is fully sepia.',
};

// Literal per-slot field names (not built with a template string): the
// shared browser harness's own fixture-file check confirms a fixture's
// "drag" entry names a real field by searching this page's own source text
// for a quoted occurrence of that exact name.
const SLOT_FIELD_NAMES = [
  { fn: 'fn1', amount: 'amount1', shadow: 'shadow1', shadowBlur: 'shadowBlur1', shadowColor: 'shadowColor1' },
  { fn: 'fn2', amount: 'amount2', shadow: 'shadow2', shadowBlur: 'shadowBlur2', shadowColor: 'shadowColor2' },
  { fn: 'fn3', amount: 'amount3', shadow: 'shadow3', shadowBlur: 'shadowBlur3', shadowColor: 'shadowColor3' },
  { fn: 'fn4', amount: 'amount4', shadow: 'shadow4', shadowBlur: 'shadowBlur4', shadowColor: 'shadowColor4' },
] as const;

// Slot 2's own default amount is 0.3, not a rounder-looking value -- see the
// measured, per-engine reason next to the package's own DEFAULT_LAYERS.
const SLOT_DEFAULTS = [
  { fn: 'grayscale', amount: 60 },
  { fn: 'blur', amount: 0.3 },
  { fn: 'sepia', amount: 50 },
  { fn: 'drop-shadow', amount: 0 },
];

function slotFields(i: number): Field[] {
  const n = i + 1;
  const names = SLOT_FIELD_NAMES[i]!;
  const d = SLOT_DEFAULTS[i]!;
  const visible = (v: Values) => Number(v.count ?? 2) >= n;
  const isDropShadow = (v: Values) => visible(v) && str(v, names.fn, d.fn) === 'drop-shadow';
  const isScalar = (v: Values) => visible(v) && str(v, names.fn, d.fn) !== 'drop-shadow';
  return [
    { name: names.fn, label: `Slot ${n} function`, type: 'select', default: d.fn, options: FUNCTION_OPTIONS, visible },
    {
      name: names.amount,
      label: `Slot ${n} amount`,
      type: 'number',
      default: d.amount,
      min: -720,
      max: 300,
      step: 1,
      help: AMOUNT_HELP[d.fn] ?? 'Amount for the chosen function.',
      visible: isScalar,
    },
    {
      name: names.shadow,
      label: `Slot ${n} shadow offset`,
      type: 'point',
      axes: ['Horizontal', 'Vertical'],
      min: -50,
      max: 50,
      step: 1,
      default: { x: 0, y: 0 },
      visible: isDropShadow,
    },
    {
      name: names.shadowBlur,
      label: `Slot ${n} shadow blur (px)`,
      type: 'number',
      default: 0,
      min: 0,
      max: 100,
      step: 1,
      visible: isDropShadow,
    },
    {
      name: names.shadowColor,
      label: `Slot ${n} shadow colour`,
      type: 'color',
      default: '#000000',
      visible: isDropShadow,
    },
  ];
}

export default defineTool({
  id: 'css-filter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'count', label: 'Number of functions', type: 'select', default: '2', options: COUNT_OPTIONS },
    ...slotFields(0),
    ...slotFields(1),
    ...slotFields(2),
    ...slotFields(3),
    { name: 'width', label: 'Box width (px)', type: 'number', default: 240, min: 40, max: 480, step: 1 },
    { name: 'height', label: 'Box height (px)', type: 'number', default: 160, min: 40, max: 480, step: 1 },
  ],
  examples: [
    { label: 'Faded photo', values: {} },
    {
      label: 'Duotone-ish',
      values: { count: '2', fn1: 'sepia', amount1: 80, fn2: 'hue-rotate', amount2: 90 },
    },
    {
      label: 'Floating label',
      values: { count: '1', fn1: 'drop-shadow', shadow1: { x: 6, y: 6 }, shadowBlur1: 4, shadowColor1: '#000000' },
    },
  ],
  run(values): ToolResult {
    const count = Math.min(4, Math.max(1, Math.round(num(values, 'count', 2))));
    const functions = Array.from({ length: count }, (_, i) => {
      const names = SLOT_FIELD_NAMES[i]!;
      const d = SLOT_DEFAULTS[i]!;
      const fn = str(values, names.fn, d.fn);
      if (fn === 'drop-shadow') {
        const offset = point(values, names.shadow, { x: 0, y: 0 });
        return {
          name: 'drop-shadow' as const,
          x: offset.x,
          y: offset.y,
          blur: num(values, names.shadowBlur, 0),
          color: str(values, names.shadowColor, '#000000'),
        };
      }
      return {
        name: fn as ScalarFilterName,
        amount: num(values, names.amount, d.amount),
      };
    });

    const result = generateFilter({
      functions,
      width: num(values, 'width', 240),
      height: num(values, 'height', 160),
    });

    const outputs: OutputBlock[] = [
      {
        kind: 'preview',
        label: 'Preview and CSS',
        css: result.css,
        tree: result.tree,
        backdrop: 'plain',
        download: 'css-filter.css',
      },
      { kind: 'code', label: 'Filter only', value: result.value, language: 'css' },
    ];

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});
