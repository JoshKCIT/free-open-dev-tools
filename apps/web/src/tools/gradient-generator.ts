import { meta, generateGradient } from '@fodt/gradient-generator';
import {
  defineTool,
  point,
  num,
  str,
  bool,
  type Field,
  type OutputBlock,
  type ToolResult,
  type Values,
} from '../lib/tool-ui';

const TYPE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
  { value: 'conic', label: 'Conic' },
];
const SHAPE_OPTIONS = [
  { value: 'circle', label: 'Circle' },
  { value: 'ellipse', label: 'Ellipse' },
];
const SIZE_OPTIONS = [
  { value: 'closest-side', label: 'Closest side' },
  { value: 'closest-corner', label: 'Closest corner' },
  { value: 'farthest-side', label: 'Farthest side' },
  { value: 'farthest-corner', label: 'Farthest corner' },
];
const STOP_COUNT_OPTIONS = ['2', '3', '4', '5'].map((v) => ({ value: v, label: v }));

// Literal per-stop field names (not built with a template string): the
// shared browser harness's own fixture-file check confirms a fixture's
// "drag" entry names a real field by searching this page's own source text
// for a quoted occurrence of that exact name. This page only drags the
// single "position" field, which is already a literal name below, but the
// per-stop colour/position fields follow the same literal convention for
// consistency and to stay safe if a later fixture ever needs to name one.
const STOP_FIELD_NAMES = [
  { color: 'color1', at: 'at1' },
  { color: 'color2', at: 'at2' },
  { color: 'color3', at: 'at3' },
  { color: 'color4', at: 'at4' },
  { color: 'color5', at: 'at5' },
] as const;

const STOP_DEFAULTS = [
  { color: '#f97316', at: 0 },
  { color: '#ec4899', at: 50 },
  { color: '#6366f1', at: 100 },
  { color: '#22d3ee', at: 75 },
  { color: '#a3e635', at: 90 },
];

function stopFields(i: number): Field[] {
  const n = i + 1;
  const names = STOP_FIELD_NAMES[i]!;
  const d = STOP_DEFAULTS[i]!;
  const visible = (v: Values) => Number(v.stops ?? 3) >= n;
  return [
    { name: names.color, label: `Stop ${n} colour`, type: 'color', default: d.color, visible },
    {
      name: names.at,
      label: `Stop ${n} position (%)`,
      type: 'number',
      default: d.at,
      min: 0,
      max: 100,
      step: 1,
      visible,
    },
  ];
}

export default defineTool({
  id: 'gradient-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'type', label: 'Gradient type', type: 'radio', default: 'linear', options: TYPE_OPTIONS },
    { name: 'repeating', label: 'Repeating', type: 'checkbox', default: false },
    {
      name: 'angle',
      label: 'Angle (deg)',
      type: 'number',
      default: 90,
      min: 0,
      max: 360,
      step: 1,
      visible: (v) => v.type !== 'radial',
    },
    {
      name: 'shape',
      label: 'Ending shape',
      type: 'select',
      default: 'ellipse',
      options: SHAPE_OPTIONS,
      visible: (v) => v.type === 'radial',
    },
    {
      name: 'size',
      label: 'Ending size',
      type: 'select',
      default: 'farthest-corner',
      options: SIZE_OPTIONS,
      visible: (v) => v.type === 'radial',
    },
    {
      name: 'position',
      label: 'Centre',
      type: 'point',
      axes: ['Horizontal', 'Vertical'],
      min: 0,
      max: 100,
      step: 1,
      default: { x: 50, y: 50 },
      visible: (v) => v.type === 'radial' || v.type === 'conic',
    },
    { name: 'stops', label: 'Number of stops', type: 'select', default: '3', options: STOP_COUNT_OPTIONS },
    ...stopFields(0),
    ...stopFields(1),
    ...stopFields(2),
    ...stopFields(3),
    ...stopFields(4),
    { name: 'width', label: 'Box width (px)', type: 'number', default: 240, min: 40, max: 480, step: 1 },
    { name: 'height', label: 'Box height (px)', type: 'number', default: 160, min: 40, max: 480, step: 1 },
  ],
  examples: [
    {
      label: 'Sunset',
      values: {
        type: 'linear',
        angle: 180,
        stops: '3',
        color1: '#f97316',
        at1: 0,
        color2: '#ec4899',
        at2: 55,
        color3: '#4338ca',
        at3: 100,
      },
    },
    {
      label: 'Spotlight',
      values: {
        type: 'radial',
        shape: 'circle',
        size: 'closest-side',
        position: { x: 30, y: 30 },
        stops: '2',
        color1: '#fef9c3',
        at1: 0,
        color2: '#1e293b',
        at2: 100,
      },
    },
    {
      label: 'Colour wheel',
      values: {
        type: 'conic',
        angle: 0,
        position: { x: 50, y: 50 },
        stops: '5',
        color1: '#ef4444',
        at1: 0,
        color2: '#eab308',
        at2: 25,
        color3: '#22c55e',
        at3: 50,
        color4: '#3b82f6',
        at4: 75,
        color5: '#ef4444',
        at5: 100,
      },
    },
  ],
  run(values): ToolResult {
    const stopCount = Math.min(5, Math.max(2, Math.round(num(values, 'stops', 3))));
    const stops = Array.from({ length: stopCount }, (_, i) => {
      const names = STOP_FIELD_NAMES[i]!;
      const d = STOP_DEFAULTS[i]!;
      return {
        color: str(values, names.color, d.color),
        at: num(values, names.at, d.at),
      };
    });

    const result = generateGradient({
      type: (str(values, 'type', 'linear') as 'linear' | 'radial' | 'conic') || 'linear',
      repeating: bool(values, 'repeating', false),
      angle: num(values, 'angle', 90),
      shape: str(values, 'shape', 'ellipse') as 'circle' | 'ellipse',
      size: str(values, 'size', 'farthest-corner') as
        'closest-side' | 'closest-corner' | 'farthest-side' | 'farthest-corner',
      position: point(values, 'position', { x: 50, y: 50 }),
      stops,
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
        download: 'gradient-generator.css',
      },
      { kind: 'code', label: 'Gradient only', value: result.value, language: 'css' },
    ];

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});
