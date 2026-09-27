import { meta, FileSignatureError, PdfToImageError } from '@fodt/pdf-to-image';
import { renderPdfInPage } from '../lib/run-pdf-to-image';
import { defineTool, files, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** A 2 MB cap on the first-page preview, matching this project's other data: URL preview budgets. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export default defineTool({
  id: 'pdf-to-image',
  // A file is read only when Run is pressed (D-10), and rendering runs in
  // a background worker, so a Cancel control is offered while it is in
  // flight.
  autoRun: false,
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    // No accept filter beyond PDF: this page only ever reads a PDF.
    { name: 'file', label: 'PDF file', type: 'file', accept: 'application/pdf,.pdf' },
    {
      name: 'dpi',
      label: 'Resolution (dots per inch)',
      type: 'number',
      default: 150,
      min: 72,
      max: 600,
      step: 1,
      help: 'Higher values give sharper images and larger files.',
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'file');
    if (picked.length === 0) return { outputs: [] };
    const file = picked[0]!;
    const dpi = num(values, 'dpi', 150);

    let rendered;
    try {
      rendered = await renderPdfInPage(file, { dpi }, ctx);
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own cancel handling already owns the single cancel note.
      if (ctx.signal.aborted) throw err;
      if (err instanceof FileSignatureError || err instanceof PdfToImageError) {
        return { outputs: [], errors: [{ message: `Could not render '${file.name}': ${err.message}.` }] };
      }
      return {
        outputs: [],
        errors: [{ message: `Could not render '${file.name}': ${err instanceof Error ? err.message : String(err)}` }],
      };
    }

    const outputs: OutputBlock[] = [
      {
        kind: 'files',
        label: 'Rendered pages',
        files: rendered.map((p) => ({ name: p.name, mime: p.mime, content: p.bytes })),
      },
    ];

    const first = rendered[0];
    if (first && first.bytes.length <= MAX_PREVIEW_BYTES) {
      outputs.push({
        kind: 'image',
        label: 'First page',
        src: `data:${first.mime};base64,${bytesToBase64(first.bytes)}`,
        alt: `Page 1 of ${file.name}, rendered at ${dpi} dots per inch`,
        width: first.width,
        height: first.height,
      });
    }

    return {
      outputs,
      stats: [
        ['Pages rendered', String(rendered.length)],
        ['Resolution', `${dpi} dots per inch`],
        ['Page size', first ? `${first.width} × ${first.height} px` : '—'],
      ],
    };
  },
});
