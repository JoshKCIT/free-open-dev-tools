import { meta, generateBorderRadius } from '@fodt/border-radius';
import { defineTool, point, num, str, type Field, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const cornerField = (name: string, label: string): Field => ({
  name,
  label,
  type: 'point',
  axes: ['Horizontal', 'Vertical'],
  min: 0,
  max: 200,
  step: 1,
  default: { x: 24, y: 24 },
});

export default defineTool({
  id: 'border-radius',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    cornerField('topLeft', 'Top-left corner'),
    cornerField('topRight', 'Top-right corner'),
    cornerField('bottomRight', 'Bottom-right corner'),
    cornerField('bottomLeft', 'Bottom-left corner'),
    {
      name: 'unit',
      label: 'Unit',
      type: 'radio',
      default: 'px',
      options: [
        { value: 'px', label: 'Pixels' },
        { value: '%', label: 'Percent' },
      ],
    },
    { name: 'width', label: 'Box width (px)', type: 'number', default: 240, min: 40, max: 480, step: 1 },
    { name: 'height', label: 'Box height (px)', type: 'number', default: 160, min: 40, max: 480, step: 1 },
    { name: 'background', label: 'Background colour', type: 'color', default: '#2563eb' },
  ],
  examples: [
    {
      label: 'Pill',
      values: {
        unit: 'px',
        width: 240,
        height: 80,
        topLeft: { x: 40, y: 40 },
        topRight: { x: 40, y: 40 },
        bottomRight: { x: 40, y: 40 },
        bottomLeft: { x: 40, y: 40 },
      },
    },
    {
      label: 'Leaf',
      values: {
        unit: 'px',
        width: 240,
        height: 160,
        topLeft: { x: 0, y: 0 },
        topRight: { x: 120, y: 120 },
        bottomRight: { x: 0, y: 0 },
        bottomLeft: { x: 120, y: 120 },
      },
    },
    {
      label: 'Blob',
      values: {
        unit: '%',
        width: 240,
        height: 200,
        topLeft: { x: 60, y: 40 },
        topRight: { x: 40, y: 60 },
        bottomRight: { x: 60, y: 40 },
        bottomLeft: { x: 40, y: 60 },
      },
    },
  ],
  run(values): ToolResult {
    const unit = str(values, 'unit', 'px') === '%' ? '%' : 'px';
    const result = generateBorderRadius({
      corners: {
        topLeft: point(values, 'topLeft', { x: 24, y: 24 }),
        topRight: point(values, 'topRight', { x: 24, y: 24 }),
        bottomRight: point(values, 'bottomRight', { x: 24, y: 24 }),
        bottomLeft: point(values, 'bottomLeft', { x: 24, y: 24 }),
      },
      unit,
      width: num(values, 'width', 240),
      height: num(values, 'height', 160),
      background: str(values, 'background', '#2563eb'),
    });

    const outputs: OutputBlock[] = [
      {
        kind: 'preview',
        label: 'Preview and CSS',
        css: result.css,
        tree: result.tree,
        backdrop: 'plain',
        download: 'border-radius.css',
      },
      {
        kind: 'keyvalue',
        label: 'Corner radii',
        pairs: [
          ['Top-left', result.longhands.topLeft],
          ['Top-right', result.longhands.topRight],
          ['Bottom-right', result.longhands.bottomRight],
          ['Bottom-left', result.longhands.bottomLeft],
        ],
      },
    ];

    if (result.overlapScale !== null) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `The corner radii overlap. A real browser would scale them all down by a factor of about ${result.overlapScale.toFixed(3)} (CSS Backgrounds and Borders Level 3, Overlapping Curves).`,
      });
    }

    return {
      outputs,
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
    };
  },
});
