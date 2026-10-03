import { meta, generateSpinner, colourOrDefault, CssSpinnerError, SPINNER_TYPES } from '@fodt/css-spinner';
import { defineTool, num, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const DEFAULT_COLOUR = '#1d4ed8';
const TYPE_OPTIONS = [...SPINNER_TYPES].map(([value, label]) => ({ value, label }));

export default defineTool({
  id: 'css-spinner',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'type', label: 'Kind', type: 'radio', default: 'ring', options: TYPE_OPTIONS },
    { name: 'size', label: 'Size (px)', type: 'number', default: 48, min: 16, max: 256, step: 1 },
    {
      name: 'speed',
      label: 'Speed (s)',
      type: 'number',
      default: 1,
      min: 0.2,
      max: 5,
      step: 0.1,
      help: 'Seconds for one turn or one beat.',
    },
    { name: 'colour', label: 'Colour', type: 'color', default: DEFAULT_COLOUR },
  ],
  examples: [
    { label: 'Ring', values: { type: 'ring', size: 48, speed: 1, colour: DEFAULT_COLOUR } },
    { label: 'Dots', values: { type: 'dots', size: 64, speed: 1.2, colour: '#be123c' } },
    { label: 'Ripple', values: { type: 'ripple', size: 96, speed: 1.6, colour: '#0f766e' } },
  ],
  run(values, ctx): ToolResult {
    try {
      // The colour box takes any typed text, so a bad one falls back to the default with a warning.
      const colour = colourOrDefault(str(values, 'colour', DEFAULT_COLOUR), DEFAULT_COLOUR, 'Colour');
      const result = generateSpinner({
        type: str(values, 'type', 'ring'),
        size: num(values, 'size', 48),
        speed: num(values, 'speed', 1),
        colour: colour.colour,
      });
      const outputs: OutputBlock[] = [
        {
          kind: 'preview',
          label: 'Preview and CSS',
          css: result.css,
          tree: result.tree,
          backdrop: 'plain',
          download: 'spinner.css',
        },
        {
          kind: 'code',
          label: 'Markup for this CSS (the first element also carries role="status" and a label for screen readers)',
          value: result.markup,
          language: 'html',
        },
      ];
      const warnings = [colour.warning, ...result.warnings].filter((w): w is string => w !== null);
      return { outputs, warnings: warnings.length > 0 ? warnings : undefined };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof CssSpinnerError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'The spinner could not be made. Reset the fields and try again.' }] };
    }
  },
});
