import { meta, extractFromPixels, paletteCss, SAMPLE_PATTERN, type QuantizedColor } from '@fodt/image-color-extractor';
import { IMAGE_TIME_LIMIT_MS, extractColorsInWorker } from '../lib/run-image-color-extractor-in-worker';
import {
  defineTool,
  str,
  num,
  bool,
  files,
  formatBytes,
  type OutputBlock,
  type RunContext,
  type ToolResult,
} from '../lib/tool-ui';

function colorOutputs(colors: QuantizedColor[]): OutputBlock[] {
  return [
    {
      kind: 'swatches',
      label: 'Palette',
      colors: colors.map((c, i) => ({
        css: c.hex,
        label: c.hex,
        caption: `Colour ${i + 1} -- ${Math.round(c.share * 100)}%`,
      })),
    },
    {
      kind: 'table',
      label: 'Colours',
      table: {
        headers: ['#', 'HEX', 'RGB', 'Share'],
        rows: colors.map((c, i) => [i + 1, c.hex, `rgb(${c.r}, ${c.g}, ${c.b})`, `${(c.share * 100).toFixed(1)}%`]),
        mono: [1, 2],
      },
    },
    {
      kind: 'code',
      label: 'CSS custom properties',
      language: 'css',
      value: paletteCss(colors),
      download: 'image-colours.css',
    },
  ];
}

export default defineTool({
  id: 'image-color-extractor',
  // The only file-reading page in this phase: a file is read only when the
  // visitor presses Run (D-10), and the read happens entirely in a
  // background worker so the tab stays responsive.
  autoRun: false,
  cancellable: true,
  runLimit: { ms: IMAGE_TIME_LIMIT_MS },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'source',
      label: 'Image source',
      type: 'radio',
      default: 'file',
      options: [
        { value: 'file', label: 'My own image' },
        { value: 'sample', label: 'Built-in four-colour test pattern' },
      ],
    },
    {
      name: 'image',
      label: 'Image',
      type: 'file',
      accept: 'image/png,image/jpeg,image/gif,image/webp,image/bmp',
      visible: (values) => str(values, 'source', 'file') === 'file',
    },
    {
      name: 'count',
      label: 'Number of colours',
      type: 'select',
      default: '6',
      options: Array.from({ length: 10 }, (_, i) => i + 3).map((n) => ({ value: String(n), label: String(n) })),
    },
    {
      name: 'ignoreTransparent',
      label: 'Ignore mostly-transparent pixels',
      type: 'checkbox',
      default: true,
    },
  ],
  async run(values, ctx: RunContext): Promise<ToolResult> {
    const count = num(values, 'count', 6);
    const ignoreTransparent = bool(values, 'ignoreTransparent', true);
    const source = str(values, 'source', 'file');

    if (source === 'sample') {
      const { colors, sampled } = extractFromPixels(SAMPLE_PATTERN.rgba, SAMPLE_PATTERN.width, SAMPLE_PATTERN.height, {
        count,
        ignoreTransparent,
      });
      return {
        outputs: colorOutputs(colors),
        stats: [
          ['File size', 'built in, no file read'],
          ['Dimensions', `${SAMPLE_PATTERN.width} x ${SAMPLE_PATTERN.height}`],
          ['Pixels sampled', String(sampled)],
        ],
      };
    }

    const picked = files(values, 'image');
    if (picked.length === 0) return { outputs: [] };
    const file = picked[0]!;

    try {
      const result = await extractColorsInWorker(file, { count, ignoreTransparent }, ctx);
      return {
        outputs: colorOutputs(result.colors),
        stats: [
          ['File size', file.size === 0 ? '0 B (empty file)' : formatBytes(file.size)],
          ['Dimensions', `${result.width} x ${result.height} (${result.type.toUpperCase()})`],
          ['Pixels sampled', String(result.sampled)],
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own catch path already owns the single cancellation note.
      if (ctx.signal.aborted) throw err;
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : String(err) }],
      };
    }
  },
});
