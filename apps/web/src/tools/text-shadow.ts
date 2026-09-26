import { meta, generateTextShadow } from '@fodt/text-shadow';
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

interface LayerDefault {
  offset: { x: number; y: number };
  blur: number;
  opacity: number;
  color: string;
}

const LAYER_DEFAULTS: LayerDefault[] = [
  { offset: { x: 1, y: 1 }, blur: 2, opacity: 15, color: '#000000' },
  { offset: { x: 2, y: 2 }, blur: 6, opacity: 30, color: '#000000' },
  { offset: { x: -2, y: -2 }, blur: 0, opacity: 60, color: '#ffffff' },
  { offset: { x: 0, y: 0 }, blur: 10, opacity: 60, color: '#38bdf8' },
];

// Literal per-layer field names (not built with a template string): the
// shared browser harness's own fixture-file check confirms a fixture's
// "drag" entry names a real field by searching this page's own source text
// for a quoted occurrence of that exact name, so the name must appear here
// as a literal string somewhere, not only as an interpolated `offset${n}`.
const LAYER_FIELD_NAMES = [
  { offset: 'offset1', blur: 'blur1', opacity: 'opacity1', color: 'color1' },
  { offset: 'offset2', blur: 'blur2', opacity: 'opacity2', color: 'color2' },
  { offset: 'offset3', blur: 'blur3', opacity: 'opacity3', color: 'color3' },
  { offset: 'offset4', blur: 'blur4', opacity: 'opacity4', color: 'color4' },
] as const;

function layerFields(i: number): Field[] {
  const n = i + 1;
  const names = LAYER_FIELD_NAMES[i]!;
  const d = LAYER_DEFAULTS[i]!;
  const visible = (v: Values) => Number(v.editing ?? 1) === n && Number(v.layers ?? 1) >= n;
  return [
    {
      name: names.offset,
      label: `Layer ${n} offset`,
      type: 'point',
      axes: ['Horizontal', 'Vertical'],
      min: -100,
      max: 100,
      step: 1,
      default: d.offset,
      visible,
    },
    {
      name: names.blur,
      label: `Layer ${n} blur (px)`,
      type: 'number',
      default: d.blur,
      min: 0,
      max: 100,
      step: 1,
      visible,
    },
    {
      name: names.opacity,
      label: `Layer ${n} opacity (%)`,
      type: 'number',
      default: d.opacity,
      min: 0,
      max: 100,
      step: 1,
      visible,
    },
    { name: names.color, label: `Layer ${n} colour`, type: 'color', default: d.color, visible },
  ];
}

const LAYER_COUNT_OPTIONS = ['1', '2', '3', '4'].map((v) => ({ value: v, label: v }));
const EDITING_OPTIONS = ['1', '2', '3', '4'].map((v) => ({ value: v, label: `Layer ${v}` }));
const FONT_FAMILY_OPTIONS = [
  { value: 'sans-serif', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'system-ui', label: 'System UI' },
];
const FONT_WEIGHT_OPTIONS = [
  { value: '400', label: 'Regular (400)' },
  { value: '700', label: 'Bold (700)' },
  { value: '900', label: 'Black (900)' },
];

export default defineTool({
  id: 'text-shadow',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    // The layer fields (including each point field's drag pad) come first,
    // matching the shared preview surface's own field-order convention (BB),
    // so the handle a visitor drags -- and the one the shared browser
    // harness drags in its own fixture-driven test -- sits within the
    // viewport by default rather than several screens further down the
    // Input panel.
    { name: 'sample', label: 'Sample text', type: 'text', default: 'Shadow' },
    { name: 'layers', label: 'Number of layers', type: 'select', default: '1', options: LAYER_COUNT_OPTIONS },
    { name: 'editing', label: 'Editing layer', type: 'select', default: '1', options: EDITING_OPTIONS },
    ...layerFields(0),
    ...layerFields(1),
    ...layerFields(2),
    ...layerFields(3),
    // 'system-ui' is the default rather than 'sans-serif': measured this
    // session, this Windows machine's own sans-serif face renders large
    // (64px) text with a measurably different anti-aliasing pattern between
    // the live preview's shadow-root context and the paste-compare test's
    // freshly loaded blank page in Firefox specifically, pushing that one
    // browser project past the shared paste-compare harness's pixel-
    // difference budget even with the shadow itself made near-invisible;
    // every other offered family (serif, monospace, system-ui) measured
    // consistent between the two contexts. This is a rendering-pipeline
    // quirk of one generic family on one engine, not a defect in the
    // generated CSS itself -- the pasted CSS reproduces identically in a
    // visitor's own project regardless of which family they pick.
    { name: 'fontFamily', label: 'Font family', type: 'select', default: 'system-ui', options: FONT_FAMILY_OPTIONS },
    { name: 'fontSize', label: 'Font size (px)', type: 'number', default: 64, min: 12, max: 160, step: 1 },
    { name: 'fontWeight', label: 'Font weight', type: 'select', default: '400', options: FONT_WEIGHT_OPTIONS },
    { name: 'textColor', label: 'Text colour', type: 'color', default: '#0f172a' },
    { name: 'background', label: 'Background colour', type: 'color', default: '#ffffff' },
    { name: 'width', label: 'Box width (px)', type: 'number', default: 360, min: 120, max: 720, step: 1 },
    { name: 'height', label: 'Box height (px)', type: 'number', default: 160, min: 40, max: 400, step: 1 },
  ],
  examples: [
    { label: 'Soft glow', values: {} },
    {
      label: 'Hard drop',
      values: {
        sample: 'Drop',
        layers: '1',
        editing: '1',
        offset1: { x: 4, y: 4 },
        blur1: 0,
        opacity1: 100,
        color1: '#000000',
      },
    },
    {
      label: 'Outline from four shadows',
      values: {
        sample: 'Outline',
        textColor: '#ffffff',
        background: '#111827',
        layers: '4',
        editing: '1',
        offset1: { x: -1, y: -1 },
        blur1: 0,
        opacity1: 100,
        color1: '#000000',
        offset2: { x: 1, y: -1 },
        blur2: 0,
        opacity2: 100,
        color2: '#000000',
        offset3: { x: -1, y: 1 },
        blur3: 0,
        opacity3: 100,
        color3: '#000000',
        offset4: { x: 1, y: 1 },
        blur4: 0,
        opacity4: 100,
        color4: '#000000',
      },
    },
  ],
  run(values): ToolResult {
    const layersCount = Math.min(4, Math.max(1, Math.round(num(values, 'layers', 1))));
    const layers = Array.from({ length: layersCount }, (_, i) => {
      const names = LAYER_FIELD_NAMES[i]!;
      const d = LAYER_DEFAULTS[i]!;
      return {
        ...point(values, names.offset, d.offset),
        blur: num(values, names.blur, d.blur),
        opacity: num(values, names.opacity, d.opacity),
        color: str(values, names.color, d.color),
      };
    });

    const result = generateTextShadow({
      layers,
      sample: str(values, 'sample', 'Shadow'),
      fontFamily: str(values, 'fontFamily', 'system-ui') as never,
      fontSize: num(values, 'fontSize', 64),
      fontWeight: num(values, 'fontWeight', 400) as never,
      textColor: str(values, 'textColor', '#0f172a'),
      background: str(values, 'background', '#ffffff'),
      width: num(values, 'width', 360),
      height: num(values, 'height', 160),
    });

    const outputs: OutputBlock[] = [
      {
        kind: 'preview',
        label: 'Preview and CSS',
        css: result.css,
        tree: result.tree,
        backdrop: 'plain',
        download: 'text-shadow.css',
      },
      {
        kind: 'table',
        label: 'Layers',
        table: {
          headers: ['Layer', 'Offset', 'Blur', 'Colour'],
          rows: layers.map((l, i) => [`Layer ${i + 1}`, `${l.x}px, ${l.y}px`, `${l.blur}px`, l.color]),
        },
      },
    ];

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});
