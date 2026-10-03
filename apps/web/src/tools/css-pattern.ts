import { meta, generatePattern, colourOrDefault, CssPatternError, PATTERNS } from '@fodt/css-pattern';
import { defineTool, num, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const DEFAULT_FOREGROUND = '#1d4ed8';
const DEFAULT_BACKGROUND = '#dbeafe';
const PATTERN_OPTIONS = [...PATTERNS].map(([value, label]) => ({ value, label }));
const OUTPUT_OPTIONS = [
  { value: 'gradient', label: 'CSS gradients' },
  { value: 'svg', label: 'Inline SVG' },
];

const hasThickness = (v: Values) => {
  const pattern = str(v, 'pattern', 'stripes-diagonal');
  return pattern !== 'checks' && pattern !== 'zigzag';
};

export default defineTool({
  id: 'css-pattern',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'pattern', label: 'Pattern', type: 'radio', default: 'stripes-diagonal', options: PATTERN_OPTIONS },
    {
      name: 'output',
      label: 'Output',
      type: 'radio',
      default: 'gradient',
      options: OUTPUT_OPTIONS,
      help: 'Gradients show live beside the CSS; an inline SVG shows in a frame with no scripts.',
    },
    { name: 'foreground', label: 'Foreground', type: 'color', default: DEFAULT_FOREGROUND },
    { name: 'background', label: 'Background', type: 'color', default: DEFAULT_BACKGROUND },
    {
      name: 'size',
      label: 'Size (px)',
      type: 'number',
      default: 24,
      min: 4,
      max: 200,
      step: 1,
      help: 'The distance after which the pattern repeats.',
    },
    {
      name: 'thickness',
      label: 'Thickness (%)',
      type: 'number',
      default: 20,
      min: 1,
      max: 50,
      step: 1,
      help: 'Line or dot size as a share of the size.',
      visible: hasThickness,
    },
  ],
  examples: [
    {
      label: 'Diagonal stripes',
      values: {
        pattern: 'stripes-diagonal',
        output: 'gradient',
        foreground: DEFAULT_FOREGROUND,
        background: DEFAULT_BACKGROUND,
        size: 24,
        thickness: 20,
      },
    },
    {
      label: 'Polka dots as SVG',
      values: {
        pattern: 'dots',
        output: 'svg',
        foreground: '#be123c',
        background: '#ffe4e6',
        size: 28,
        thickness: 20,
      },
    },
    {
      label: 'Checks',
      values: { pattern: 'checks', output: 'gradient', foreground: '#1e293b', background: '#f1f5f9', size: 32 },
    },
  ],
  run(values, ctx): ToolResult {
    try {
      // The colour boxes take any typed text, so a bad one falls back to the default with a warning.
      const foreground = colourOrDefault(
        str(values, 'foreground', DEFAULT_FOREGROUND),
        DEFAULT_FOREGROUND,
        'Foreground',
      );
      const background = colourOrDefault(
        str(values, 'background', DEFAULT_BACKGROUND),
        DEFAULT_BACKGROUND,
        'Background',
      );
      const result = generatePattern({
        pattern: str(values, 'pattern', 'stripes-diagonal'),
        output: str(values, 'output', 'gradient'),
        foreground: foreground.colour,
        background: background.colour,
        size: num(values, 'size', 24),
        thickness: num(values, 'thickness', 20),
      });

      const markup: OutputBlock = {
        kind: 'code',
        label: 'Markup for this CSS',
        value: result.markup,
        language: 'html',
      };
      const outputs: OutputBlock[] =
        result.output === 'gradient'
          ? [
              {
                kind: 'preview',
                label: 'Preview and CSS',
                css: result.css,
                tree: result.tree,
                backdrop: 'plain',
                download: 'pattern.css',
              },
              markup,
            ]
          : [
              // The frame holds exactly the CSS shown below it; it has no scripts and may load only data addresses.
              { kind: 'sandboxed-html', label: 'Preview (a frame with no scripts)', html: result.html, copy: false },
              { kind: 'code', label: 'CSS to copy', value: result.css, language: 'css', download: 'pattern.css' },
              markup,
            ];
      const warnings = [foreground.warning, background.warning, ...result.warnings].filter(
        (w): w is string => w !== null,
      );
      return { outputs, warnings: warnings.length > 0 ? warnings : undefined };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof CssPatternError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'The pattern could not be made. Reset the fields and try again.' }] };
    }
  },
});
