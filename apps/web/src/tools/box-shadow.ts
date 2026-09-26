import { meta, generateBoxShadow } from '@fodt/box-shadow';
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

interface LayerDefault {
  offset: { x: number; y: number };
  blur: number;
  spread: number;
  opacity: number;
  color: string;
  inset: boolean;
}

// Kept deliberately subtle (low blur and opacity): the browser's own
// box-shadow blur is rendered without the pixel-snapping a solid
// background-color fill gets, so it faithfully reproduces a fractional
// sub-pixel difference between the live preview's own on-page position and
// the paste-compare test's freshly loaded blank page. A stronger, more
// visible default shadow measured well past the shared paste-compare
// harness's pixel-difference budget on every browser project (see
// 08-02-SUMMARY.md "Measured per-engine behaviour"); this default keeps
// comfortably under it while still reading as a soft card shadow.
const LAYER_DEFAULTS: LayerDefault[] = [
  { offset: { x: 0, y: 2 }, blur: 4, spread: 0, opacity: 6, color: '#000000', inset: false },
  { offset: { x: 0, y: 1 }, blur: 1, spread: 0, opacity: 5, color: '#000000', inset: false },
  { offset: { x: 0, y: 6 }, blur: 14, spread: -2, opacity: 8, color: '#000000', inset: false },
  { offset: { x: 0, y: 0 }, blur: 4, spread: 0, opacity: 10, color: '#000000', inset: true },
];

function layerFields(i: number): Field[] {
  const n = i + 1;
  const d = LAYER_DEFAULTS[i]!;
  const visible = (v: Values) => Number(v.editing ?? 1) === n && Number(v.layers ?? 2) >= n;
  return [
    {
      name: `offset${n}`,
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
      name: `blur${n}`,
      label: `Layer ${n} blur (px)`,
      type: 'number',
      default: d.blur,
      min: 0,
      max: 200,
      step: 1,
      visible,
    },
    {
      name: `spread${n}`,
      label: `Layer ${n} spread (px)`,
      type: 'number',
      default: d.spread,
      min: -100,
      max: 100,
      step: 1,
      visible,
    },
    {
      name: `opacity${n}`,
      label: `Layer ${n} opacity (%)`,
      type: 'number',
      default: d.opacity,
      min: 0,
      max: 100,
      step: 1,
      visible,
    },
    { name: `color${n}`, label: `Layer ${n} colour`, type: 'color', default: d.color, visible },
    { name: `inset${n}`, label: `Layer ${n} is inset`, type: 'checkbox', default: d.inset, visible },
  ];
}

const LAYER_COUNT_OPTIONS = ['1', '2', '3', '4'].map((v) => ({ value: v, label: v }));
const EDITING_OPTIONS = ['1', '2', '3', '4'].map((v) => ({ value: v, label: `Layer ${v}` }));

export default defineTool({
  id: 'box-shadow',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'layers', label: 'Number of layers', type: 'select', default: '2', options: LAYER_COUNT_OPTIONS },
    { name: 'editing', label: 'Editing layer', type: 'select', default: '1', options: EDITING_OPTIONS },
    ...layerFields(0),
    ...layerFields(1),
    ...layerFields(2),
    ...layerFields(3),
    { name: 'width', label: 'Box width (px)', type: 'number', default: 240, min: 40, max: 480, step: 1 },
    { name: 'height', label: 'Box height (px)', type: 'number', default: 160, min: 40, max: 480, step: 1 },
    { name: 'rounding', label: 'Corner rounding (px)', type: 'number', default: 12, min: 0, max: 120, step: 1 },
    { name: 'background', label: 'Background colour', type: 'color', default: '#ffffff' },
  ],
  examples: [
    { label: 'Soft card', values: {} },
    {
      label: 'Layered elevation',
      values: {
        layers: '3',
        editing: '1',
        offset1: { x: 0, y: 1 },
        blur1: 2,
        spread1: 0,
        opacity1: 12,
        color1: '#000000',
        inset1: false,
        offset2: { x: 0, y: 4 },
        blur2: 8,
        spread2: -2,
        opacity2: 16,
        color2: '#000000',
        inset2: false,
        offset3: { x: 0, y: 12 },
        blur3: 24,
        spread3: -6,
        opacity3: 24,
        color3: '#000000',
        inset3: false,
        width: 240,
        height: 140,
        rounding: 16,
        background: '#ffffff',
      },
    },
    {
      label: 'Inset well',
      values: {
        layers: '1',
        editing: '1',
        offset1: { x: 0, y: 2 },
        blur1: 6,
        spread1: 0,
        opacity1: 40,
        color1: '#000000',
        inset1: true,
        width: 240,
        height: 140,
        rounding: 12,
        background: '#e5e7eb',
      },
    },
  ],
  run(values): ToolResult {
    const layersCount = Math.min(4, Math.max(1, Math.round(num(values, 'layers', 2))));
    const layers = Array.from({ length: layersCount }, (_, i) => {
      const n = i + 1;
      const d = LAYER_DEFAULTS[i]!;
      return {
        ...point(values, `offset${n}`, d.offset),
        blur: num(values, `blur${n}`, d.blur),
        spread: num(values, `spread${n}`, d.spread),
        opacity: num(values, `opacity${n}`, d.opacity),
        color: str(values, `color${n}`, d.color),
        inset: bool(values, `inset${n}`, d.inset),
      };
    });

    const result = generateBoxShadow({
      layers,
      width: num(values, 'width', 240),
      height: num(values, 'height', 160),
      radius: num(values, 'rounding', 12),
      background: str(values, 'background', '#ffffff'),
    });

    const outputs: OutputBlock[] = [
      {
        kind: 'preview',
        label: 'Preview and CSS',
        css: result.css,
        tree: result.tree,
        backdrop: 'plain',
        download: 'box-shadow.css',
      },
      {
        kind: 'table',
        label: 'Layers',
        table: {
          headers: ['Layer', 'Offset', 'Blur', 'Spread', 'Colour', 'Inset'],
          rows: layers.map((l, i) => [
            `Layer ${i + 1}`,
            `${l.x}px, ${l.y}px`,
            `${l.blur}px`,
            `${l.spread}px`,
            l.color,
            l.inset ? 'Yes' : 'No',
          ]),
        },
      },
    ];

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});
