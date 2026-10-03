import { checkPadding, meta, spriteCss, SpriteSheetError, SHEET_FILE_NAME } from '@fodt/sprite-sheet';
import { buildSpriteSheet, SpriteSheetRunError } from '../lib/run-sprite-sheet-on-canvas';
import { defineTool, files, num, str, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';

/** Turns bytes into a data: URL without spreading the whole array onto the call stack at once. */
function bytesToDataUrl(bytes: Uint8Array, mediaType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
}

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

export default defineTool({
  id: 'sprite-sheet',
  // Decoding and drawing several pictures is real work, so this waits for a deliberate Run press and offers a Cancel
  // button while that work is in flight.
  autoRun: false,
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'images',
      label: 'Images',
      type: 'file',
      accept: ACCEPT,
      multiple: true,
      help: 'PNG, JPEG, GIF, WebP or BMP pictures, up to 200 of them, each up to 20 MB and 4,096 pixels a side. They are packed in the order you pick them.',
    },
    {
      name: 'layout',
      label: 'Layout',
      type: 'radio',
      default: 'grid',
      options: [
        { value: 'grid', label: 'Grid' },
        { value: 'shelf', label: 'Shelf' },
      ],
      help: 'Grid: equal cells in the order picked. Shelf: tallest first, packed in rows, with less empty space.',
    },
    {
      name: 'padding',
      label: 'Padding',
      type: 'number',
      default: 2,
      min: 0,
      max: 64,
      step: 1,
      help: 'Whole pixels of space between neighbouring sprites, from 0 to 64.',
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'images');
    if (picked.length === 0) return { outputs: [] };
    const layout = str(values, 'layout', 'grid') === 'shelf' ? 'shelf' : 'grid';

    try {
      // Padding is checked first: a value outside 0 to 64 or not whole never reaches a loop or an allocation.
      const padding = checkPadding(num(values, 'padding', 2));
      const { png, plan } = await buildSpriteSheet(picked, { layout, padding }, ctx);
      const css = spriteCss(plan);
      const count = plan.placements.length;

      const outputs: OutputBlock[] = [];
      if (png.byteLength <= MAX_PREVIEW_BYTES) {
        outputs.push({
          kind: 'image',
          label: 'Sprite sheet',
          src: bytesToDataUrl(png, 'image/png'),
          alt: count === 1 ? 'Sprite sheet of 1 image' : `Sprite sheet of ${count} images`,
          width: plan.width,
          height: plan.height,
        });
      } else {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `The sprite sheet is larger than 2 MB, so it is not previewed here. Download ${SHEET_FILE_NAME} to see it.`,
        });
      }
      outputs.push({ kind: 'code', label: 'CSS', language: 'css', value: css, download: 'sprite.css' });
      outputs.push({
        kind: 'code',
        label: 'Example markup',
        language: 'html',
        value: plan.placements.map((p) => `<span class="sprite sprite-${p.className}"></span>`).join('\n'),
      });
      outputs.push({
        kind: 'files',
        label: 'Download the sheet and its CSS (keep them in the same folder)',
        files: [
          { name: SHEET_FILE_NAME, mime: 'image/png', content: png },
          { name: 'sprite.css', mime: 'text/css', content: css },
        ],
      });
      outputs.push({
        kind: 'table',
        label: 'Sprites',
        table: {
          headers: ['Class', 'X', 'Y', 'Width', 'Height'],
          rows: plan.placements.map((p) => [`sprite-${p.className}`, p.x, p.y, p.width, p.height]),
          mono: [0],
        },
      });
      return {
        outputs,
        stats: [
          ['Sprites', String(count)],
          ['Sheet', `${plan.width} by ${plan.height} pixels`],
          ['Layout', layout === 'shelf' ? 'Shelf' : 'Grid'],
          ['Padding', `${padding} px`],
          ['PNG size', formatBytes(png.byteLength)],
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancel handling already owns the
      // single cancellation note, matching this project's own established worker-page pattern.
      if (ctx.signal.aborted) throw err;
      if (err instanceof SpriteSheetError || err instanceof SpriteSheetRunError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      return { outputs: [], errors: [{ message: 'Could not pack these images.' }] };
    }
  },
});
