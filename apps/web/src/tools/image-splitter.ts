import { ImageSplitterError, meta, type TileFormat, type TileMode, type TileRect } from '@fodt/image-splitter';
import { ImageSplitterRunError, splitImage } from '../lib/run-image-splitter-on-canvas';
import {
  defineTool,
  files,
  formatBytes,
  num,
  str,
  type OutputBlock,
  type ToolResult,
  type Values,
} from '../lib/tool-ui';

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';

function modeIs(values: Values, mode: 'grid' | 'size'): boolean {
  return (str(values, 'mode', 'grid') === 'size' ? 'size' : 'grid') === mode;
}

/** `2 by 3` when every tile is the same size, otherwise the smallest and largest of each side. */
function sizeText(tiles: TileRect[]): string {
  const widths = tiles.map((t) => t.width);
  const heights = tiles.map((t) => t.height);
  const range = (list: number[]) => {
    const low = Math.min(...list);
    const high = Math.max(...list);
    return low === high ? String(low) : `${low} to ${high}`;
  };
  return `${range(widths)} by ${range(heights)} pixels`;
}

/** What is different about the tiles at the edge, in plain words. */
function edgeText(tiles: TileRect[], mode: TileMode): string {
  const widths = new Set(tiles.map((t) => t.width));
  const heights = new Set(tiles.map((t) => t.height));
  if (widths.size === 1 && heights.size === 1) return 'None: every tile is the same size';
  if (mode.kind === 'grid') return 'None: tiles differ by one pixel at most, because the size does not divide evenly';
  const last = tiles[tiles.length - 1]!;
  const parts: string[] = [];
  if (widths.size > 1) parts.push(`the last column is ${last.width} pixels wide`);
  if (heights.size > 1) parts.push(`the last row is ${last.height} pixels tall`);
  return `Smaller: ${parts.join(' and ')}`;
}

export default defineTool({
  id: 'image-splitter',
  // Decoding a picture and encoding up to 400 tiles is real work, so this waits for a deliberate Run press and offers a
  // Cancel button while that work is in flight.
  autoRun: false,
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'file',
      label: 'Image',
      type: 'file',
      accept: ACCEPT,
      help: 'A PNG, JPEG, GIF, WebP or BMP picture, up to 100 MB and 40,000,000 pixels.',
    },
    {
      name: 'mode',
      label: 'Split by',
      type: 'radio',
      default: 'grid',
      options: [
        { value: 'grid', label: 'Rows and columns' },
        { value: 'size', label: 'Tile size' },
      ],
      help: 'Rows and columns divide the picture evenly. Tile size starts at the top left and leaves smaller tiles at the right and bottom edges.',
    },
    {
      name: 'rows',
      label: 'Rows',
      type: 'number',
      default: 2,
      min: 1,
      max: 100,
      step: 1,
      visible: (values) => modeIs(values, 'grid'),
      help: 'Whole number from 1 to 100. At most 400 tiles in all.',
    },
    {
      name: 'columns',
      label: 'Columns',
      type: 'number',
      default: 2,
      min: 1,
      max: 100,
      step: 1,
      visible: (values) => modeIs(values, 'grid'),
      help: 'Whole number from 1 to 100.',
    },
    {
      name: 'tileWidth',
      label: 'Tile width',
      type: 'number',
      default: 256,
      min: 1,
      max: 40000,
      step: 1,
      visible: (values) => modeIs(values, 'size'),
      help: 'Pixels, from 1 to 40,000. At most 400 tiles in all.',
    },
    {
      name: 'tileHeight',
      label: 'Tile height',
      type: 'number',
      default: 256,
      min: 1,
      max: 40000,
      step: 1,
      visible: (values) => modeIs(values, 'size'),
      help: 'Pixels, from 1 to 40,000.',
    },
    {
      name: 'format',
      label: 'Tile format',
      type: 'radio',
      default: 'png',
      options: [
        { value: 'png', label: 'PNG' },
        { value: 'jpeg', label: 'JPEG' },
      ],
      help: 'PNG keeps every pixel exactly. JPEG is smaller but loses some detail.',
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'file');
    if (picked.length === 0) return { outputs: [] };
    const file = picked[0]!;
    const format: TileFormat = str(values, 'format', 'png') === 'jpeg' ? 'jpeg' : 'png';
    // Only the fields that belong to the chosen mode are read; a hidden field never changes the result.
    const mode: TileMode = modeIs(values, 'size')
      ? { kind: 'size', tileWidth: num(values, 'tileWidth', 256), tileHeight: num(values, 'tileHeight', 256) }
      : { kind: 'grid', rows: num(values, 'rows', 2), columns: num(values, 'columns', 2) };

    try {
      const { zip, tiles } = await splitImage(file, mode, format, ctx);
      const rows = Math.max(...tiles.map((t) => t.row));
      const columns = Math.max(...tiles.map((t) => t.column));
      const imageWidth = Math.max(...tiles.map((t) => t.x + t.width));
      const imageHeight = Math.max(...tiles.map((t) => t.y + t.height));

      const outputs: OutputBlock[] = [
        {
          kind: 'files',
          label: 'Download the tiles',
          files: [{ name: 'tiles.zip', mime: 'application/zip', content: zip }],
        },
        {
          kind: 'keyvalue',
          label: 'Result',
          pairs: [
            ['Tiles', `${tiles.length} (${rows} rows by ${columns} columns)`],
            ['Image', `${imageWidth} by ${imageHeight} pixels`],
            ['Tile size', sizeText(tiles)],
            ['Edge tiles', edgeText(tiles, mode)],
            ['Format', format === 'jpeg' ? 'JPEG' : 'PNG'],
          ],
        },
      ];
      if (format === 'jpeg') {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: 'JPEG tiles lose some detail, and transparent areas of the picture became white.',
        });
      }
      outputs.push({
        kind: 'table',
        label: 'Tiles',
        table: {
          headers: ['Name', 'X', 'Y', 'Width', 'Height'],
          rows: tiles.map((t) => [t.name, t.x, t.y, t.width, t.height]),
          mono: [0],
        },
      });
      return { outputs, stats: [['ZIP size', formatBytes(zip.byteLength)]] };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancel handling already owns the
      // single cancellation note, matching this project's own established worker-page pattern.
      if (ctx.signal.aborted) throw err;
      if (err instanceof ImageSplitterError || err instanceof ImageSplitterRunError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      return { outputs: [], errors: [{ message: 'Could not split this image.' }] };
    }
  },
});
