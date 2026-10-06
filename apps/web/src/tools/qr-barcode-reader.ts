import {
  meta,
  checkImageFile,
  codeRows,
  CodeReaderError,
  MAX_IMAGE_HEADER_BYTES,
  MAX_INPUT_BYTES,
  type CodeResult,
} from '@fodt/qr-barcode-reader';
import { scanWithCamera, CameraScanError } from '../lib/camera-scan';
import {
  QR_BARCODE_READER_TIME_LIMIT_MS,
  imagePixelsFromFile,
  openReaderSession,
  readCodesInWorker,
  QrBarcodeReaderRunError,
} from '../lib/run-qr-barcode-reader-in-worker';
import { defineTool, files, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** The blocks shown for a read: a table of every code, the first code's text on its own, or a plain no-code note. */
function resultOf(results: CodeResult[], size?: { width: number; height: number }): ToolResult {
  const stats: [string, string][] = [['Codes found', String(results.length)]];
  if (size) stats.push(['Image size', `${size.width} by ${size.height} pixels`]);
  const outputs: OutputBlock[] = [];
  if (results.length === 0) {
    outputs.push({ kind: 'note', tone: 'info', value: 'No code was found in this image.' });
  } else {
    outputs.push({
      kind: 'table',
      label: 'Codes',
      table: { headers: ['Format', 'Text', 'Notes'], rows: codeRows(results), mono: [1] },
    });
    outputs.push({ kind: 'code', label: 'Text of the first code', value: results[0]!.shown });
  }
  return { outputs, stats };
}

export default defineTool({
  id: 'qr-barcode-reader',
  // Reading a picture is real background work in a module worker, so this waits for a deliberate Run press and offers
  // a Cancel button while that work is in flight.
  autoRun: false,
  cancellable: true,
  runLimit: { ms: QR_BARCODE_READER_TIME_LIMIT_MS },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'source',
      label: 'Read from',
      type: 'radio',
      default: 'file',
      options: [
        { value: 'file', label: 'Image file' },
        { value: 'camera', label: 'Camera' },
      ],
    },
    {
      name: 'file',
      visible: (values) => str(values, 'source', 'file') === 'file',
      label: 'Image file',
      type: 'file',
      accept: 'image/png,image/jpeg,image/gif,image/webp,image/bmp',
      help: 'A PNG, JPEG, GIF, WebP or BMP picture of a QR code or barcode, up to 50 MB.',
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    // Only the fields of the chosen source are read: a file picked earlier never changes a camera read.
    if (str(values, 'source', 'file') === 'camera') {
      try {
        return resultOf(await scanWithCamera(ctx, openReaderSession));
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        if (
          err instanceof CameraScanError ||
          err instanceof CodeReaderError ||
          err instanceof QrBarcodeReaderRunError
        ) {
          return { outputs: [], errors: [{ message: err.message }] };
        }
        return { outputs: [], errors: [{ message: 'Could not read from the camera.' }] };
      }
    }
    const picked = files(values, 'file');
    if (picked.length === 0) return { outputs: [] };
    const file = picked[0]!;

    try {
      // A file over the size limit is refused from its reported size before a single byte of it is read. The start of the
      // file is read up to 2 MiB, since a photograph's frame header can lie behind a long profile.
      const header =
        file.size > MAX_INPUT_BYTES
          ? new Uint8Array(0)
          : new Uint8Array(await file.slice(0, MAX_IMAGE_HEADER_BYTES).arrayBuffer());
      checkImageFile(header, file.size);
      const pixels = await imagePixelsFromFile(file);
      const results = await readCodesInWorker(pixels, ctx);
      return resultOf(results, { width: pixels.width, height: pixels.height });
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof CodeReaderError || err instanceof QrBarcodeReaderRunError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      return { outputs: [], errors: [{ message: 'Could not read this image.' }] };
    }
  },
});
