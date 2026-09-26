import { meta, generateEffect } from '@fodt/css-effects';
import { defineTool, num, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const MODE_OPTIONS = [
  { value: 'glass', label: 'Frosted glass' },
  { value: 'soft', label: 'Soft UI' },
];
const SHAPE_OPTIONS = [
  { value: 'flat', label: 'Flat' },
  { value: 'concave', label: 'Concave' },
  { value: 'convex', label: 'Convex' },
  { value: 'pressed', label: 'Pressed' },
];

const isGlass = (v: Values) => str(v, 'mode', 'glass') === 'glass';
const isSoft = (v: Values) => str(v, 'mode', 'glass') === 'soft';

export default defineTool({
  id: 'css-effects',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'mode', label: 'Mode', type: 'radio', default: 'glass', options: MODE_OPTIONS },
    // Glass-only fields.
    { name: 'blur', label: 'Blur (px)', type: 'number', default: 12, min: 0, max: 40, step: 1, visible: isGlass },
    {
      name: 'saturation',
      label: 'Saturation (%)',
      type: 'number',
      default: 160,
      min: 100,
      max: 200,
      step: 1,
      visible: isGlass,
    },
    { name: 'tint', label: 'Tint colour', type: 'color', default: '#ffffff', visible: isGlass },
    {
      name: 'tintOpacity',
      label: 'Tint opacity (%)',
      type: 'number',
      default: 20,
      min: 0,
      max: 100,
      step: 1,
      visible: isGlass,
    },
    {
      name: 'borderOpacity',
      label: 'Border opacity (%)',
      type: 'number',
      default: 40,
      min: 0,
      max: 100,
      step: 1,
      visible: isGlass,
    },
    {
      name: 'rounding',
      label: 'Corner rounding (px)',
      type: 'number',
      default: 16,
      min: 0,
      max: 48,
      step: 1,
      visible: isGlass,
    },
    // Soft UI-only fields.
    { name: 'base', label: 'Base colour', type: 'color', default: '#e0e5ec', visible: isSoft },
    {
      name: 'distance',
      label: 'Shadow distance (px)',
      type: 'number',
      default: 8,
      min: 1,
      max: 40,
      step: 1,
      visible: isSoft,
    },
    { name: 'softBlur', label: 'Blur (px)', type: 'number', default: 16, min: 0, max: 80, step: 1, visible: isSoft },
    {
      name: 'intensity',
      label: 'Intensity (%)',
      type: 'number',
      default: 15,
      min: 1,
      max: 50,
      step: 1,
      visible: isSoft,
    },
    { name: 'shape', label: 'Shape', type: 'select', default: 'flat', options: SHAPE_OPTIONS, visible: isSoft },
    {
      name: 'softRounding',
      label: 'Corner rounding (px)',
      type: 'number',
      default: 20,
      min: 0,
      max: 48,
      step: 1,
      visible: isSoft,
    },
    // Shared subject size.
    { name: 'width', label: 'Box width (px)', type: 'number', default: 240, min: 80, max: 400, step: 1 },
    { name: 'height', label: 'Box height (px)', type: 'number', default: 160, min: 80, max: 400, step: 1 },
  ],
  examples: [
    { label: 'Frosted card', values: { mode: 'glass', blur: 16, saturation: 180, tintOpacity: 25 } },
    { label: 'Soft button', values: { mode: 'soft', shape: 'convex', intensity: 15 } },
    { label: 'Pressed well', values: { mode: 'soft', shape: 'pressed', intensity: 20 } },
  ],
  run(values): ToolResult {
    const mode = str(values, 'mode', 'glass') === 'soft' ? 'soft' : 'glass';
    const result = generateEffect({
      mode,
      glass: {
        blur: num(values, 'blur', 12),
        saturation: num(values, 'saturation', 160),
        tint: str(values, 'tint', '#ffffff'),
        tintOpacity: num(values, 'tintOpacity', 20),
        borderOpacity: num(values, 'borderOpacity', 40),
        rounding: num(values, 'rounding', 16),
      },
      soft: {
        base: str(values, 'base', '#e0e5ec'),
        distance: num(values, 'distance', 8),
        blur: num(values, 'softBlur', 16),
        intensity: num(values, 'intensity', 15),
        shape: str(values, 'shape', 'flat') as never,
        rounding: num(values, 'softRounding', 20),
      },
      width: num(values, 'width', 240),
      height: num(values, 'height', 160),
    });

    const outputs: OutputBlock[] = [
      {
        kind: 'preview',
        label: 'Preview and CSS',
        css: result.css,
        tree: result.tree,
        backdrop: result.backdrop,
        download: 'css-effects.css',
      },
    ];

    if (result.contrastRatio !== null) {
      outputs.push({
        kind: 'keyvalue',
        label: 'Shadow edge contrast',
        pairs: [['Contrast against the base colour', `${result.contrastRatio.toFixed(2)}:1`]],
      });
    }

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});
