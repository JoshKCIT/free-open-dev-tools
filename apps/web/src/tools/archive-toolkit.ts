import { meta } from '@fodt/archive-toolkit';
import {
  extractArchiveInWorker,
  createZipInWorker,
  ArchiveToolkitRunError,
} from '../lib/run-archive-toolkit-in-worker';
import {
  defineTool,
  files,
  str,
  num,
  bool,
  formatBytes,
  type OutputBlock,
  type ToolResult,
  type Values,
} from '../lib/tool-ui';

function isCreate(values: Values): boolean {
  return str(values, 'mode', 'extract') === 'create';
}

export default defineTool({
  id: 'archive-toolkit',
  autoRun: false,
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'extract',
      options: [
        { value: 'extract', label: 'Extract' },
        { value: 'create', label: 'Create ZIP' },
      ],
    },
    {
      name: 'archive',
      label: 'Archive file',
      type: 'file',
      accept: '.zip,.tar,.tgz,.gz,application/zip,application/gzip,application/x-tar',
      visible: (v) => !isCreate(v),
    },
    {
      name: 'files',
      label: 'Files to add',
      type: 'file',
      multiple: true,
      visible: (v) => isCreate(v),
    },
    {
      name: 'method',
      label: 'Compression',
      type: 'select',
      default: 'deflate',
      options: [
        { value: 'deflate', label: 'Deflate' },
        { value: 'store', label: 'Store' },
      ],
      visible: (v) => isCreate(v),
    },
    {
      name: 'level',
      label: 'Level',
      type: 'number',
      default: 6,
      min: 1,
      max: 9,
      step: 1,
      visible: (v) => isCreate(v) && str(v, 'method', 'deflate') === 'deflate',
    },
    {
      name: 'keepTimes',
      label: 'Keep modification times',
      type: 'checkbox',
      default: true,
      visible: (v) => isCreate(v),
    },
    {
      name: 'zipName',
      label: 'ZIP file name',
      type: 'text',
      default: 'archive.zip',
      visible: (v) => isCreate(v),
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    if (isCreate(values)) {
      const picked = files(values, 'files');
      if (picked.length === 0) return { outputs: [] };
      const method = str(values, 'method', 'deflate') === 'store' ? 'store' : 'deflate';
      const level = Math.min(9, Math.max(1, num(values, 'level', 6))) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
      const keepTimes = bool(values, 'keepTimes', true);
      const zipName = str(values, 'zipName', 'archive.zip') || 'archive.zip';

      let result;
      try {
        result = await createZipInWorker(picked, { method, level, keepTimes, zipName }, ctx);
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        if (err instanceof ArchiveToolkitRunError) {
          return { outputs: [], errors: [{ message: err.message }] };
        }
        return {
          outputs: [],
          errors: [{ message: err instanceof Error ? err.message : 'Could not create this ZIP.' }],
        };
      }

      const outputs: OutputBlock[] = [
        {
          kind: 'files',
          label: 'Output',
          files: [{ name: result.zipName, mime: 'application/zip', content: result.bytes }],
        },
        {
          kind: 'table',
          label: 'Entries',
          table: {
            headers: ['Name', 'Size', 'Packed', 'Modified'],
            rows: result.entries.map((e) => [e.name, formatBytes(e.size), formatBytes(e.packedSize), e.modified]),
          },
        },
      ];

      return {
        outputs,
        stats: [
          ['Files', String(result.entries.length)],
          ['ZIP size', formatBytes(result.bytes.length)],
        ],
      };
    }

    const picked = files(values, 'archive');
    if (picked.length === 0) return { outputs: [] };
    const file = picked[0]!;

    let result;
    try {
      result = await extractArchiveInWorker(file, ctx);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof ArchiveToolkitRunError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : `Could not read '${file.name}'.` }],
      };
    }

    const outputs: OutputBlock[] = [
      {
        kind: 'table',
        label: 'Entries',
        table: {
          headers: ['Path', 'Type', 'Size', 'Packed', 'Modified', 'Status'],
          rows: result.entries.map((e) => [
            e.path,
            e.type,
            formatBytes(e.size),
            e.packedSize !== undefined ? formatBytes(e.packedSize) : '',
            e.modified ?? '',
            e.status,
          ]),
        },
      },
    ];

    const notExtracted = result.entries.filter((e) => e.status !== 'extracted');
    if (notExtracted.length > 0) {
      const summary = notExtracted.map((e) => `${e.path}: ${e.status}${e.reason ? ` (${e.reason})` : ''}`).join('; ');
      outputs.push({ kind: 'note', tone: 'warn', value: `Not extracted: ${summary}` });
    }
    for (const warning of result.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });

    const extractedFiles = result.files;
    if (extractedFiles.length > 0) {
      outputs.push({
        kind: 'files',
        label: 'Extracted files',
        files: extractedFiles.map((f) => ({ name: f.name, mime: 'application/octet-stream', content: f.bytes })),
      });
    }

    const totalSize = result.entries.reduce((sum, e) => sum + e.size, 0);
    return {
      outputs,
      stats: [
        ['Entries', String(result.entries.length)],
        ['Extracted', String(result.entries.filter((e) => e.status === 'extracted').length)],
        ['Not extracted', String(notExtracted.length)],
        ['Total size', formatBytes(totalSize)],
      ],
    };
  },
});
