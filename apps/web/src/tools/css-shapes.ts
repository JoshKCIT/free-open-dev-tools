import { meta, generateShape, colourOrDefault, CssShapesError, SHAPES, TRIANGLE_DIRECTIONS } from '@fodt/css-shapes';
import { defineTool, num, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const DEFAULT_COLOUR = '#1d4ed8';
const DEFAULT_BACKGROUND = '#dbeafe';
const SHAPE_OPTIONS = [...SHAPES].map(([value, label]) => ({ value, label }));
const DIRECTION_OPTIONS = [...TRIANGLE_DIRECTIONS].map(([value, label]) => ({ value, label }));
const METHOD_OPTIONS = [
  { value: 'border', label: 'Borders' },
  { value: 'clip-path', label: 'clip-path' },
];
const TAIL_OPTIONS = [
  { value: 'bottom-left', label: 'Bottom left (bubble)' },
  { value: 'bottom-right', label: 'Bottom right (bubble)' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top (tooltip)' },
  { value: 'bottom', label: 'Bottom (tooltip)' },
];

const isTriangle = (v: Values) => str(v, 'shape', 'triangle') === 'triangle';
const hasText = (v: Values) => !isTriangle(v);
const hasTail = (v: Values) => {
  const shape = str(v, 'shape', 'triangle');
  return shape === 'bubble' || shape === 'tooltip';
};

/** A side that does not fit the chosen shape (the other shape's corner or edge) falls back to that shape's usual side. */
function tailFor(shape: string, picked: string): string {
  const bubble = ['bottom-left', 'bottom-right', 'left', 'right'];
  const tooltip = ['top', 'bottom', 'left', 'right'];
  if (shape === 'bubble') return bubble.includes(picked) ? picked : 'bottom-left';
  return tooltip.includes(picked) ? picked : 'bottom';
}

export default defineTool({
  id: 'css-shapes',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'shape', label: 'Shape', type: 'radio', default: 'triangle', options: SHAPE_OPTIONS },
    {
      name: 'direction',
      label: 'Direction',
      type: 'select',
      default: 'up',
      options: DIRECTION_OPTIONS,
      visible: isTriangle,
    },
    {
      name: 'method',
      label: 'Method',
      type: 'radio',
      default: 'border',
      options: METHOD_OPTIONS,
      help: 'Borders work in every browser; clip-path cuts a coloured box to a polygon.',
      visible: isTriangle,
    },
    {
      name: 'tail',
      label: 'Tail side',
      type: 'select',
      default: 'bottom-left',
      options: TAIL_OPTIONS,
      help: 'A choice that does not fit the shape uses its usual side.',
      visible: hasTail,
    },
    { name: 'width', label: 'Width (px)', type: 'number', default: 160, min: 8, max: 400, step: 1 },
    { name: 'height', label: 'Height (px)', type: 'number', default: 80, min: 8, max: 400, step: 1 },
    {
      name: 'colour',
      label: 'Colour',
      type: 'color',
      default: DEFAULT_COLOUR,
      help: 'The triangle itself, or the text on a ribbon, bubble or tooltip.',
    },
    {
      name: 'background',
      label: 'Background',
      type: 'color',
      default: DEFAULT_BACKGROUND,
      help: 'The fill of a ribbon, bubble or tooltip and its tail.',
      visible: hasText,
    },
    {
      name: 'text',
      label: 'Text',
      type: 'text',
      default: 'Hello there!',
      help: 'One line, at most 200 characters. It goes in the markup only, never in the CSS.',
      visible: hasText,
    },
  ],
  examples: [
    {
      label: 'Up triangle',
      values: { shape: 'triangle', direction: 'up', method: 'border', width: 100, height: 100, colour: '#1d4ed8' },
    },
    {
      label: 'Speech bubble',
      values: {
        shape: 'bubble',
        tail: 'bottom-left',
        width: 160,
        height: 80,
        colour: '#1d4ed8',
        background: '#dbeafe',
        text: 'Hello there!',
      },
    },
    {
      label: 'Ribbon',
      values: { shape: 'ribbon', width: 180, height: 48, colour: '#ffffff', background: '#be123c', text: 'New' },
    },
    {
      label: 'Tooltip',
      values: {
        shape: 'tooltip',
        tail: 'bottom',
        width: 160,
        height: 48,
        colour: '#ffffff',
        background: '#1e293b',
        text: 'Copied',
      },
    },
  ],
  run(values, ctx): ToolResult {
    try {
      const shape = str(values, 'shape', 'triangle');
      // The colour boxes take any typed text, so a bad one falls back to the default with a warning.
      const colour = colourOrDefault(str(values, 'colour', DEFAULT_COLOUR), DEFAULT_COLOUR, 'Colour');
      const background = colourOrDefault(
        str(values, 'background', DEFAULT_BACKGROUND),
        DEFAULT_BACKGROUND,
        'Background',
      );
      const result = generateShape({
        shape,
        direction: str(values, 'direction', 'up'),
        method: str(values, 'method', 'border'),
        tail: tailFor(shape, str(values, 'tail', 'bottom-left')),
        width: num(values, 'width', 160),
        height: num(values, 'height', 80),
        colour: colour.colour,
        background: background.colour,
        text: str(values, 'text', ''),
      });
      const outputs: OutputBlock[] = [
        {
          kind: 'preview',
          label: 'Preview and CSS',
          css: result.css,
          tree: result.tree,
          backdrop: 'plain',
          download: 'shape.css',
        },
        { kind: 'code', label: 'Markup for this CSS', value: result.markup, language: 'html' },
      ];
      const warnings = [colour.warning, hasText(values) ? background.warning : null, ...result.warnings].filter(
        (w): w is string => w !== null,
      );
      return { outputs, warnings: warnings.length > 0 ? warnings : undefined };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof CssShapesError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'The shape could not be made. Reset the fields and try again.' }] };
    }
  },
});
