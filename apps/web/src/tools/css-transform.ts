import { meta, generateTransform } from '@fodt/css-transform';
import { defineTool, point, num, str, bool, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const ORDER_OPTIONS = [
  { value: 'translate-rotate-scale-skew', label: 'Translate, Rotate, Scale, Skew' },
  { value: 'rotate-translate-scale-skew', label: 'Rotate, Translate, Scale, Skew' },
  { value: 'scale-rotate-translate-skew', label: 'Scale, Rotate, Translate, Skew' },
  { value: 'skew-scale-rotate-translate', label: 'Skew, Scale, Rotate, Translate' },
];

export default defineTool({
  id: 'css-transform',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'translate',
      label: 'Move',
      type: 'point',
      axes: ['Horizontal', 'Vertical'],
      min: -150,
      max: 150,
      step: 1,
      default: { x: 0, y: 0 },
    },
    {
      name: 'skew',
      label: 'Skew',
      type: 'point',
      axes: ['Horizontal', 'Vertical'],
      min: -60,
      max: 60,
      step: 1,
      default: { x: 0, y: 0 },
    },
    {
      name: 'origin',
      label: 'Origin',
      type: 'point',
      axes: ['Horizontal', 'Vertical'],
      min: 0,
      max: 100,
      step: 1,
      default: { x: 50, y: 50 },
    },
    // Placed directly after the three point fields (not beside the scale
    // fields it governs): the shared browser harness's drag test dispatches
    // raw pointer events at real viewport coordinates with no auto-scroll,
    // and on WebKit specifically, Playwright's own `.fill()`/`.selectOption()`
    // do not scroll the page the way `.check()` on a real checkbox does.
    // This checkbox is the origin drag entry's own scroll trigger (its
    // fixture steps check and uncheck it): being right below `origin`, the
    // minimal scroll needed to reveal it also reveals the origin pad above
    // it, on every engine (measured this session).
    { name: 'uniformScale', label: 'Uniform scale', type: 'checkbox', default: false },
    { name: 'rotate', label: 'Rotate (deg)', type: 'number', default: 0, min: -360, max: 360, step: 1 },
    { name: 'scaleX', label: 'Scale horizontal', type: 'number', default: 1, min: 0.1, max: 4, step: 0.1 },
    {
      name: 'scaleY',
      label: 'Scale vertical',
      type: 'number',
      default: 1,
      min: 0.1,
      max: 4,
      step: 0.1,
      visible: (v: Values) => !bool(v, 'uniformScale'),
    },
    { name: 'order', label: 'Order', type: 'select', default: 'translate-rotate-scale-skew', options: ORDER_OPTIONS },
    { name: 'individual', label: 'Use individual translate/rotate/scale properties', type: 'checkbox', default: false },
    { name: 'width', label: 'Box width (px)', type: 'number', default: 120, min: 40, max: 240, step: 1 },
    { name: 'height', label: 'Box height (px)', type: 'number', default: 120, min: 40, max: 240, step: 1 },
    { name: 'background', label: 'Background colour', type: 'color', default: '#93c5fd' },
  ],
  examples: [
    {
      label: 'Tilted card',
      values: { translate: { x: 0, y: 0 }, rotate: -6, scaleX: 1, scaleY: 1, skew: { x: -4, y: 0 } },
    },
    {
      label: 'Mirror',
      values: { rotate: 180, translate: { x: 0, y: 0 }, scaleX: 1, scaleY: 1, origin: { x: 50, y: 50 } },
    },
    {
      label: 'Order matters',
      values: {
        order: 'rotate-translate-scale-skew',
        rotate: 30,
        translate: { x: 40, y: 0 },
        scaleX: 1,
        scaleY: 1,
      },
    },
  ],
  run(values): ToolResult {
    const uniform = bool(values, 'uniformScale', false);
    const scaleX = num(values, 'scaleX', 1);
    const scaleY = uniform ? scaleX : num(values, 'scaleY', 1);
    const result = generateTransform({
      translate: point(values, 'translate', { x: 0, y: 0 }),
      rotate: num(values, 'rotate', 0),
      scale: { x: scaleX, y: scaleY },
      skew: point(values, 'skew', { x: 0, y: 0 }),
      origin: point(values, 'origin', { x: 50, y: 50 }),
      order: str(values, 'order', 'translate-rotate-scale-skew'),
      individual: bool(values, 'individual', false),
      width: num(values, 'width', 120),
      height: num(values, 'height', 120),
      background: str(values, 'background', '#93c5fd'),
    });

    const [a, b, c, d, e, f] = result.matrix;
    const outputs: OutputBlock[] = [
      {
        kind: 'preview',
        label: 'Preview and CSS',
        css: result.css,
        tree: result.tree,
        backdrop: 'plain',
        download: 'css-transform.css',
      },
      {
        kind: 'keyvalue',
        label: 'Equivalent matrix',
        pairs: [['matrix', `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`]],
      },
    ];

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});
