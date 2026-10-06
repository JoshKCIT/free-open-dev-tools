import {
  meta,
  checkImageFile,
  checkThreshold,
  DEFAULT_THRESHOLD,
  ImageCompareError,
  MAX_HEADER_BYTES,
  MAX_INPUT_BYTES,
  padPixels,
  planCompare,
  shareText,
} from '@fodt/image-compare';
import {
  IMAGE_COMPARE_TIME_LIMIT_MS,
  compareInWorker,
  decodeToPixels,
  pixelsToPng,
  ImageCompareRunError,
  type DecodedPixels,
} from '../lib/run-image-compare-in-worker';
import { defineTool, bool, files, num, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

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

/** Checks one picked file by its reported size and its header, naming which picture a refusal is about. */
async function checkFile(file: File, label: string): Promise<void> {
  try {
    // A file over the size limit is refused from its reported size before a single byte of it is read.
    const header =
      file.size > MAX_INPUT_BYTES
        ? new Uint8Array(0)
        : new Uint8Array(await file.slice(0, MAX_HEADER_BYTES).arrayBuffer());
    checkImageFile(header, file.size);
  } catch (err) {
    if (err instanceof ImageCompareError) throw new ImageCompareError(`${label}: ${err.message}`);
    throw err;
  }
}

async function decode(file: File, label: string): Promise<DecodedPixels> {
  try {
    return await decodeToPixels(file);
  } catch (err) {
    if (err instanceof ImageCompareRunError) throw new ImageCompareRunError(`${label}: ${err.message}`);
    throw err;
  }
}

export default defineTool({
  id: 'image-compare',
  // Decoding two pictures and comparing them is real background work, so this waits for a deliberate Run press and
  // offers a Cancel button while that work is in flight.
  autoRun: false,
  cancellable: true,
  runLimit: { ms: IMAGE_COMPARE_TIME_LIMIT_MS },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'imageA',
      label: 'First image',
      type: 'file',
      accept: ACCEPT,
      help: 'A PNG, JPEG, GIF, WebP or BMP picture, up to 50 MB and 16,000,000 pixels. The differences are drawn on a faded copy of this one.',
    },
    {
      name: 'imageB',
      label: 'Second image',
      type: 'file',
      accept: ACCEPT,
      help: 'The picture to compare it with, in the same kinds and limits.',
    },
    {
      name: 'threshold',
      label: 'Threshold',
      type: 'number',
      default: DEFAULT_THRESHOLD,
      min: 0,
      max: 1,
      step: 0.01,
      help: 'From 0 (any change counts) to 1. Smaller is more sensitive. This is the colour-difference threshold of the pixelmatch library, not a percentage.',
    },
    {
      name: 'includeAA',
      label: 'Count anti-aliased pixels',
      type: 'checkbox',
      default: false,
      help: 'Off: pixels that look like soft edges (anti-aliasing) are skipped, drawn yellow and not counted. On: they count too.',
    },
    {
      name: 'onSizeMismatch',
      label: 'If the sizes differ',
      type: 'select',
      default: 'refuse',
      options: [
        { value: 'refuse', label: 'Refuse different sizes' },
        { value: 'pad', label: 'Pad smaller image' },
      ],
      help: 'Padding adds transparent pixels at the right and bottom of the smaller picture so the two can be compared.',
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const first = files(values, 'imageA');
    const second = files(values, 'imageB');
    if (first.length === 0 || second.length === 0) return { outputs: [] };
    const fileA = first[0]!;
    const fileB = second[0]!;
    const includeAA = bool(values, 'includeAA', false);
    const mismatch = str(values, 'onSizeMismatch', 'refuse') === 'pad' ? 'pad' : 'refuse';

    try {
      const threshold = checkThreshold(num(values, 'threshold', DEFAULT_THRESHOLD));
      // Both files are checked, by size and by header, before either is decoded.
      await checkFile(fileA, 'First image');
      await checkFile(fileB, 'Second image');

      const pixelsA = await decode(fileA, 'First image');
      if (ctx.signal.aborted) throw new ImageCompareRunError('The run was cancelled.');
      const pixelsB = await decode(fileB, 'Second image');
      const plan = planCompare(pixelsA, pixelsB, mismatch);
      const a = plan.padded
        ? padPixels(pixelsA.data, pixelsA.width, pixelsA.height, plan.width, plan.height)
        : pixelsA.data;
      const b = plan.padded
        ? padPixels(pixelsB.data, pixelsB.width, pixelsB.height, plan.width, plan.height)
        : pixelsB.data;

      const result = await compareInWorker({ a, b, width: plan.width, height: plan.height, threshold, includeAA }, ctx);
      const png = await pixelsToPng(result.diff, plan.width, plan.height);

      const outputs: OutputBlock[] = [
        {
          kind: 'keyvalue',
          label: 'Result',
          pairs: [
            ['Differing pixels', `${result.differing} of ${result.total}`],
            ['Share', shareText(result.differing, result.total)],
            ['Compared size', `${plan.width} by ${plan.height} pixels`],
            ['Threshold', String(threshold)],
            ['Anti-aliased pixels counted', includeAA ? 'Yes' : 'No'],
          ],
        },
      ];
      if (plan.padded) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `The smaller picture was padded with transparent pixels at its right and bottom edges to ${plan.width} by ${plan.height} pixels, so the padded area counts as different wherever the other picture has colour.`,
        });
      }
      if (png.byteLength <= MAX_PREVIEW_BYTES) {
        outputs.push({
          kind: 'image',
          label: includeAA
            ? 'Difference image (red differs, gray matches)'
            : 'Difference image (red differs, gray matches, yellow skipped as anti-aliasing)',
          src: bytesToDataUrl(png, 'image/png'),
          alt: 'Difference image: differing pixels are red, matching pixels are faded gray',
          width: plan.width,
          height: plan.height,
        });
      } else {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: 'The difference image is larger than 2 MB, so it is not previewed here. Download diff.png to see it.',
        });
      }
      outputs.push({
        kind: 'files',
        label: 'Difference image file',
        files: [{ name: 'diff.png', mime: 'image/png', content: png }],
      });
      return { outputs };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancel handling already owns the
      // single cancellation note, matching this project's own established worker-page pattern.
      if (ctx.signal.aborted) throw err;
      if (err instanceof ImageCompareError || err instanceof ImageCompareRunError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      return { outputs: [], errors: [{ message: 'Could not compare these images.' }] };
    }
  },
});
