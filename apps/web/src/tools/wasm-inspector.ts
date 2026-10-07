import {
  MAX_MODULE_BYTES,
  WasmInspectorError,
  checkModuleSize,
  inspect,
  meta,
  withCommas,
  type ExportRow,
  type ImportRow,
  type Report,
} from '@fodt/wasm-inspector';
import { defineTool, files, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** What the page says first: what it reads and what it never does. */
const FIRST_NOTE =
  "This page reads the bytes of the module. It never compiles, validates or runs it, and this page's policy does not let the browser compile one. Nothing is uploaded.";

function moduleBlock(report: Report): OutputBlock {
  const pairs: [string, string][] = [
    ['Size', `${withCommas(report.size)} bytes`],
    ['Sections', withCommas(report.sectionCount)],
    ['Types', withCommas(report.types.count)],
    ['Imported functions', withCommas(report.functions.imported)],
    ['Defined functions', withCommas(report.functions.defined)],
    ['Imports', withCommas(report.imports.count)],
    ['Exports', withCommas(report.exports.count)],
  ];
  if (report.start !== null) pairs.push(['Start function', String(report.start)]);
  return { kind: 'keyvalue', label: 'Module', pairs };
}

function importsBlock(rows: readonly ImportRow[]): OutputBlock {
  return {
    kind: 'table',
    label: 'Imports',
    table: {
      headers: ['Module', 'Name', 'Kind', 'Index', 'Type'],
      rows: rows.map((row) => [row.module, row.field, row.kind, row.index, row.detail]),
      mono: [0, 1, 3],
    },
  };
}

function exportsBlock(rows: readonly ExportRow[]): OutputBlock {
  return {
    kind: 'table',
    label: 'Exports',
    table: {
      headers: ['Name', 'Kind', 'Index'],
      rows: rows.map((row) => [row.name, row.kind, row.index]),
      mono: [0, 2],
    },
  };
}

function outputsOf(report: Report): OutputBlock[] {
  const outputs: OutputBlock[] = [{ kind: 'note', tone: 'info', value: FIRST_NOTE }];
  if (report.kind !== 'module') {
    outputs.push({ kind: 'note', tone: 'info', value: report.sentence ?? 'This file is not a WebAssembly module.' });
    return outputs;
  }
  outputs.push(moduleBlock(report));
  if (report.imports.rows.length > 0) outputs.push(importsBlock(report.imports.rows));
  if (report.exports.rows.length > 0) outputs.push(exportsBlock(report.exports.rows));
  return outputs;
}

function failure(err: unknown): ToolResult {
  if (err instanceof WasmInspectorError) return { outputs: [], errors: [{ message: err.message }] };
  return { outputs: [], errors: [{ message: 'This file could not be read as a WebAssembly module.' }] };
}

export default defineTool({
  id: 'wasm-inspector',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'file',
      label: 'Open a .wasm file',
      type: 'file',
      accept: '.wasm,application/wasm',
      help: `Up to ${MAX_MODULE_BYTES / 1_048_576} MiB. The file is read here, never run, and nothing is uploaded.`,
    },
    {
      name: 'showStrings',
      label: 'List printable text found in data segments',
      type: 'checkbox',
      default: true,
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    try {
      const picked = files(values, 'file');
      if (picked.length === 0) return { outputs: [] };
      const file = picked[0]!;
      // The size comes from the file object, so an oversized file is refused before any of it is read.
      checkModuleSize(file.size);
      const bytes = new Uint8Array(await file.arrayBuffer());
      // An edit made while the file was being read has started a newer run; this one leaves nothing behind.
      if (ctx.signal.aborted) return { outputs: [] };
      return { outputs: outputsOf(inspect(bytes)) };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return failure(err);
    }
  },
});
