import { meta, generateClipPath, REGULAR_POLYGON_PRESETS } from '@fodt/clip-path';
import {
  defineTool,
  point,
  num,
  bool,
  str,
  type Field,
  type OutputBlock,
  type ToolResult,
  type Values,
} from '../lib/tool-ui';

const SHAPE_OPTIONS = [
  { value: 'polygon', label: 'Polygon' },
  { value: 'circle', label: 'Circle' },
  { value: 'ellipse', label: 'Ellipse' },
  { value: 'inset', label: 'Inset' },
];

const isShape = (name: 'polygon' | 'circle' | 'ellipse' | 'inset') => (v: Values) =>
  str(v, 'shape', 'polygon') === name;

// Literal per-point field names (not built with a template string): the
// shared browser harness's own fixture-file check confirms a fixture's
// "drag" entry names a real field by searching this page's raw source text
// for a literal quoted occurrence of that name (08-02's own precedent).
const POINT_FIELD_NAMES = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'] as const;

function pointField(
  name: (typeof POINT_FIELD_NAMES)[number],
  index: number,
  defaultPoint: { x: number; y: number },
): Field {
  return {
    name,
    label: `Point ${index + 1}`,
    type: 'point',
    axes: ['Horizontal', 'Vertical'],
    min: 0,
    max: 100,
    step: 1,
    default: defaultPoint,
    visible: (v: Values) => isShape('polygon')(v) && Number(v.vertices ?? 5) > index,
  };
}

const PENTAGON = REGULAR_POLYGON_PRESETS.pentagon;
const VERTEX_OPTIONS = Array.from({ length: 8 }, (_, i) => String(i + 3)).map((v) => ({ value: v, label: v }));

// The package's own preset vertices are precise trigonometric values (three
// decimal places); the point field's own step is a whole percent, so a
// field default that keeps those decimals would silently jump to the
// nearest whole percent the first time any handle's own arrow key or drag
// writes it (PointField.tsx's roundToStep) -- which the shared keyboard
// test reads as "did not respond", since it expects exactly default+step.
// Rounding only the on-load field default (never the package's own preset,
// still used precisely for the example buttons and generateClipPath's own
// fallback) keeps both a stable keyboard step and an exact preset shape.
function roundPoint(p: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

export default defineTool({
  id: 'clip-path',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'shape', label: 'Shape', type: 'radio', default: 'polygon', options: SHAPE_OPTIONS },
    {
      name: 'vertices',
      label: 'Points',
      type: 'select',
      default: '5',
      options: VERTEX_OPTIONS,
      visible: isShape('polygon'),
    },
    ...POINT_FIELD_NAMES.map((name, i) => pointField(name, i, roundPoint(PENTAGON[i % PENTAGON.length]!))),
    { name: 'evenodd', label: 'Even-odd fill rule', type: 'checkbox', default: false, visible: isShape('polygon') },
    {
      name: 'radius',
      label: 'Radius (%)',
      type: 'number',
      default: 40,
      min: 0,
      max: 100,
      step: 1,
      visible: isShape('circle'),
    },
    {
      name: 'center',
      label: 'Centre',
      type: 'point',
      axes: ['Horizontal', 'Vertical'],
      min: 0,
      max: 100,
      step: 1,
      default: { x: 50, y: 50 },
      visible: (v: Values) => isShape('circle')(v) || isShape('ellipse')(v),
    },
    {
      name: 'radiusX',
      label: 'Horizontal radius (%)',
      type: 'number',
      default: 50,
      min: 0,
      max: 100,
      step: 1,
      visible: isShape('ellipse'),
    },
    {
      name: 'radiusY',
      label: 'Vertical radius (%)',
      type: 'number',
      default: 35,
      min: 0,
      max: 100,
      step: 1,
      visible: isShape('ellipse'),
    },
    {
      name: 'top',
      label: 'Top offset (%)',
      type: 'number',
      default: 10,
      min: 0,
      max: 50,
      step: 1,
      visible: isShape('inset'),
    },
    {
      name: 'right',
      label: 'Right offset (%)',
      type: 'number',
      default: 20,
      min: 0,
      max: 50,
      step: 1,
      visible: isShape('inset'),
    },
    {
      name: 'bottom',
      label: 'Bottom offset (%)',
      type: 'number',
      default: 10,
      min: 0,
      max: 50,
      step: 1,
      visible: isShape('inset'),
    },
    {
      name: 'left',
      label: 'Left offset (%)',
      type: 'number',
      default: 20,
      min: 0,
      max: 50,
      step: 1,
      visible: isShape('inset'),
    },
    {
      name: 'round',
      label: 'Rounded corner (px)',
      type: 'number',
      default: 0,
      min: 0,
      max: 200,
      step: 1,
      visible: isShape('inset'),
    },
    { name: 'width', label: 'Box width (px)', type: 'number', default: 240, min: 40, max: 480, step: 1 },
    { name: 'height', label: 'Box height (px)', type: 'number', default: 240, min: 40, max: 480, step: 1 },
  ],
  examples: [
    {
      label: 'Triangle',
      values: { shape: 'polygon', vertices: '3', ...pointsToValues(REGULAR_POLYGON_PRESETS.triangle) },
    },
    {
      label: 'Rhombus',
      values: { shape: 'polygon', vertices: '4', ...pointsToValues(REGULAR_POLYGON_PRESETS.rhombus) },
    },
    {
      label: 'Pentagon',
      values: { shape: 'polygon', vertices: '5', ...pointsToValues(REGULAR_POLYGON_PRESETS.pentagon) },
    },
    {
      label: 'Hexagon',
      values: { shape: 'polygon', vertices: '6', ...pointsToValues(REGULAR_POLYGON_PRESETS.hexagon) },
    },
    {
      label: 'Octagon',
      values: { shape: 'polygon', vertices: '8', ...pointsToValues(REGULAR_POLYGON_PRESETS.octagon) },
    },
    { label: 'Star', values: { shape: 'polygon', vertices: '10', ...pointsToValues(REGULAR_POLYGON_PRESETS.star) } },
    { label: 'Rounded inset', values: { shape: 'inset', top: 15, right: 15, bottom: 15, left: 15, round: 24 } },
  ],
  run(values): ToolResult {
    const shape = str(values, 'shape', 'polygon') as 'polygon' | 'circle' | 'ellipse' | 'inset';
    const vertices = Math.min(10, Math.max(3, Math.round(num(values, 'vertices', 5))));
    const points = POINT_FIELD_NAMES.slice(0, vertices).map((name, i) =>
      point(values, name, PENTAGON[i % PENTAGON.length]!),
    );

    const result = generateClipPath({
      shape,
      points,
      evenodd: bool(values, 'evenodd', false),
      radius: num(values, 'radius', 40),
      center: point(values, 'center', { x: 50, y: 50 }),
      radiusX: num(values, 'radiusX', 50),
      radiusY: num(values, 'radiusY', 35),
      top: num(values, 'top', 10),
      right: num(values, 'right', 20),
      bottom: num(values, 'bottom', 10),
      left: num(values, 'left', 20),
      round: num(values, 'round', 0),
      width: num(values, 'width', 240),
      height: num(values, 'height', 240),
    });

    const outputs: OutputBlock[] = [
      {
        kind: 'preview',
        label: 'Preview and CSS',
        css: result.css,
        tree: result.tree,
        backdrop: 'plain',
        download: 'clip-path.css',
      },
      { kind: 'code', label: 'Shape only', value: result.value },
    ];

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});

function pointsToValues(points: { x: number; y: number }[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  points.forEach((p, i) => {
    out[POINT_FIELD_NAMES[i]!] = p;
  });
  return out;
}
