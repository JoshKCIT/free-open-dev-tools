import { meta, generateEasing, pointFieldToControl, CubicBezierError, EASING_PRESETS } from '@fodt/cubic-bezier';
import { defineTool, num, point, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const PRESET_OPTIONS = [...EASING_PRESETS].map(([value, label]) => ({ value, label }));
const isCustom = (v: Values) => str(v, 'preset', 'custom') === 'custom';
/** The handle pad shows progress upward, so its second number is 1 minus the curve's y value. */
const PAD_AXES: [string, string] = ['Time (x)', 'Progress (1 - y)'];

export default defineTool({
  id: 'cubic-bezier',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    // The handles come first so both pads are on the first screen: the shared drag test cannot scroll.
    {
      name: 'p1',
      label: 'Handle 1',
      type: 'point',
      axes: PAD_AXES,
      min: -1,
      max: 2,
      step: 0.01,
      default: { x: 0.25, y: 0.9 },
      visible: isCustom,
    },
    {
      name: 'p2',
      label: 'Handle 2',
      type: 'point',
      axes: PAD_AXES,
      min: -1,
      max: 2,
      step: 0.01,
      default: { x: 0.25, y: 0 },
      visible: isCustom,
    },
    {
      name: 'preset',
      label: 'Preset',
      type: 'select',
      default: 'custom',
      options: PRESET_OPTIONS,
      help: 'Choose Custom to drag the two handles. Time stays between 0 and 1. Progress is 1 minus the curve value, so dragging up raises the curve.',
    },
    {
      name: 'duration',
      label: 'Duration (s)',
      type: 'number',
      default: 1,
      min: 0.2,
      max: 5,
      step: 0.1,
      help: 'How long the motion preview takes to cross its track.',
    },
  ],
  examples: [
    { label: 'ease', values: { preset: 'ease', duration: 1 } },
    { label: 'ease-in-out', values: { preset: 'ease-in-out', duration: 1.5 } },
    {
      label: 'Overshoot',
      values: { preset: 'custom', p1: { x: 0.34, y: -0.56 }, p2: { x: 0.64, y: 0 }, duration: 1.2 },
    },
  ],
  run(values, ctx): ToolResult {
    try {
      // The pad's value is (x, 1 - y); x is held to 0 to 1 and the result carries a warning when it was.
      const result = generateEasing({
        preset: str(values, 'preset', 'custom'),
        p1: pointFieldToControl(point(values, 'p1', { x: 0.25, y: 0.9 })),
        p2: pointFieldToControl(point(values, 'p2', { x: 0.25, y: 0 })),
        duration: num(values, 'duration', 1),
      });
      const { x1, y1, x2, y2 } = result.points;
      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Value and declaration',
          value: `${result.value}\n${result.declaration}`,
          language: 'css',
        },
        {
          kind: 'image',
          label: 'The curve',
          src: `data:image/svg+xml,${encodeURIComponent(result.svg)}`,
          alt: `Easing curve from (0, 0) to (1, 1) with control points (${x1}, ${y1}) and (${x2}, ${y2}). Time runs left to right and progress runs upward.`,
        },
        {
          kind: 'preview',
          label: 'Motion preview and CSS',
          css: result.css,
          tree: result.tree,
          backdrop: 'plain',
          download: 'easing.css',
        },
        {
          kind: 'table',
          label: 'Progress at eleven times',
          table: { headers: ['Input time', 'Progress'], rows: result.table, mono: [0, 1] },
        },
      ];
      return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof CubicBezierError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'The curve could not be made. Reset the fields and try again.' }] };
    }
  },
});
