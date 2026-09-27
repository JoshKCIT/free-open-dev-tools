import { meta, type FileKind } from '@fodt/exif-viewer';
import { runExifViewerInWorker } from '../lib/run-exif-viewer-in-worker';
import { defineTool, bool, files, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const MEDIA_TYPES: Partial<Record<FileKind, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export default defineTool({
  id: 'exif-viewer',
  // Reading a picked photo is real background work (BQ): this waits for a
  // deliberate Run press rather than starting the moment a file is picked,
  // and offers a Cancel button while that work is in flight.
  autoRun: false,
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'file', label: 'Photo', type: 'file', accept: 'image/jpeg,image/png,image/webp' },
    {
      name: 'keepColourProfile',
      label: 'Keep the colour profile',
      type: 'checkbox',
      default: true,
      help: 'Removing it can change how colours look.',
    },
    {
      name: 'keepOrientation',
      label: 'Keep the orientation tag',
      type: 'checkbox',
      default: true,
      help: 'Removing it can show a rotated photo sideways.',
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'file');
    if (picked.length === 0) return { outputs: [] };
    const file = picked[0]!;

    let result;
    try {
      result = await runExifViewerInWorker(
        file,
        {
          keepColourProfile: bool(values, 'keepColourProfile', true),
          keepOrientation: bool(values, 'keepOrientation', true),
        },
        ctx,
      );
    } catch (err) {
      // An abort rejection is let through rather than swallowed, matching
      // every other worker-backed page in this project: the runner's own
      // catch path already owns the single cancellation note.
      if (ctx.signal.aborted) throw err;
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : `Could not read '${file.name}'.` }],
      };
    }

    const outputs: OutputBlock[] = [];

    if (result.original.gps) {
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value: `This photo records where it was taken: ${result.original.gps.latitude.toFixed(5)}, ${result.original.gps.longitude.toFixed(5)}.`,
      });
    }

    for (const block of result.original.blocks) {
      outputs.push({ kind: 'table', label: block.name, table: { headers: ['Tag', 'Value'], rows: block.rows } });
    }
    if (result.original.blocks.length === 0 && !result.original.gps) {
      outputs.push({ kind: 'note', tone: 'info', value: 'This file has no metadata this tool can read.' });
    }

    if (result.removed.length > 0) {
      outputs.push({
        kind: 'list',
        label: 'Removed',
        items: result.removed.map((r) => `${r.what} (${formatBytes(r.bytes)})`),
      });
    }

    if (result.kept.length === 0) {
      outputs.push({
        kind: 'note',
        tone: 'success',
        value: 'Checked: the copy has no EXIF, XMP, IPTC or GPS metadata.',
      });
    } else {
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value: `The copy still carries: ${result.kept.join(', ')}.`,
      });
    }
    for (const warning of result.warnings) {
      outputs.push({ kind: 'note', tone: 'warn', value: warning });
    }

    outputs.push({
      kind: 'files',
      label: 'Copy without metadata',
      files: [
        {
          name: result.fileName,
          mime: MEDIA_TYPES[result.original.kind] ?? 'application/octet-stream',
          content: result.strippedBytes,
        },
      ],
    });

    return {
      outputs,
      stats: [
        ['File', file.name],
        ['Before', formatBytes(file.size)],
        ['After', formatBytes(result.strippedBytes.length)],
      ],
    };
  },
});
