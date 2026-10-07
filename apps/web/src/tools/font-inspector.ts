import {
  FontInspectorError,
  MAX_FILE_BYTES,
  MAX_NAME_CELL_CHARS,
  checkFileSize,
  inspectFont,
  meta,
  readContainer,
  visible,
  type FontReport,
} from '@fodt/font-inspector';
import {
  FONT_INSPECTOR_TIME_LIMIT_MS,
  FontInspectorRunError,
  fontInspectorInWorker,
  type FontInspectorWrapper,
} from '../lib/run-font-inspector-in-worker';
import { defineTool, files, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** What the page says first: where the font is read and what the page never does with it. */
const FIRST_NOTE =
  'The font is read on this device and nothing is uploaded. No address inside the font (a licence or vendor address) is ever requested; such an address is shown as text only.';

const MAX_NAME_ROWS_SHOWN = 500;
const MAX_MEMBER = 100;

const PLATFORMS: readonly string[] = ['Unicode', 'Macintosh', 'ISO', 'Windows'];

const count = (value: number): string => value.toLocaleString('en-US');

const shown = (text: string): string => visible(text, MAX_NAME_CELL_CHARS);

function platformLabel(platform: number, encoding: number): string {
  return `${PLATFORMS[platform] ?? `Platform ${platform}`}, encoding ${encoding}`;
}

function containerText(report: FontReport, wrapper: FontInspectorWrapper | null): string {
  const size = `${count(report.container.fileSize)} bytes`;
  if (wrapper) {
    const name = wrapper.kind === 'woff2' ? 'WOFF2' : 'WOFF 1.0';
    return `${name}, ${size}, unpacked to ${count(wrapper.sfntSize)} bytes in ${count(wrapper.tableCount)} tables`;
  }
  if (report.container.kind === 'collection') {
    return `Collection of ${count(report.container.memberCount)} fonts, ${size}; showing font ${report.container.member}`;
  }
  return `TrueType or OpenType file, ${size}`;
}

function fontBlock(report: FontReport, wrapper: FontInspectorWrapper | null): OutputBlock {
  const f = report.font;
  const pairs: [string, string][] = [];
  if (f.family !== '') pairs.push(['Family', shown(f.family)]);
  if (f.subfamily !== '') pairs.push(['Style', shown(f.subfamily)]);
  if (f.fullName !== '') pairs.push(['Full name', shown(f.fullName)]);
  if (f.postScriptName !== '') pairs.push(['PostScript name', shown(f.postScriptName)]);
  if (f.version !== '') pairs.push(['Version', shown(f.version)]);
  pairs.push(['Container', containerText(report, wrapper)]);
  pairs.push(['Outlines', f.outlineFormat === 'none' ? 'None found' : f.outlineFormat]);
  if (f.glyphCount !== null) pairs.push(['Glyphs', count(f.glyphCount)]);
  if (f.unitsPerEm !== null) pairs.push(['Units per em', count(f.unitsPerEm)]);
  return { kind: 'keyvalue', label: 'Font', pairs };
}

function namesBlocks(report: FontReport): OutputBlock[] {
  if (report.names.length === 0) return [];
  const labels = new Map(report.nameLabels.map((n) => [n.id, n.label]));
  const rows = report.names
    .slice(0, MAX_NAME_ROWS_SHOWN)
    .map((n) => [
      `${n.id}: ${labels.get(n.id) ?? 'Other'}`,
      platformLabel(n.platform, n.encoding),
      n.languageLabel,
      n.text === null ? `(${n.undecoded ?? 'not decoded'})` : shown(n.text),
    ]);
  const out: OutputBlock[] = [
    { kind: 'table', label: 'Names', table: { headers: ['Name', 'Platform', 'Language', 'Value'], rows, mono: [3] } },
  ];
  if (report.names.length > MAX_NAME_ROWS_SHOWN) {
    out.push({
      kind: 'note',
      tone: 'info',
      value: `The table shows the first ${count(MAX_NAME_ROWS_SHOWN)} of ${count(report.names.length)} name records.`,
    });
  }
  return out;
}

function outputsOf(report: FontReport, wrapper: FontInspectorWrapper | null): OutputBlock[] {
  const outputs: OutputBlock[] = [{ kind: 'note', tone: 'info', value: FIRST_NOTE }];
  for (const note of report.notes) outputs.push({ kind: 'note', tone: note.tone, value: note.text });
  if (wrapper) for (const text of wrapper.notes) outputs.push({ kind: 'note', tone: 'info', value: text });
  outputs.push(fontBlock(report, wrapper));
  outputs.push(...namesBlocks(report));
  return outputs;
}

function failure(err: unknown): ToolResult {
  if (err instanceof FontInspectorError || err instanceof FontInspectorRunError) {
    return { outputs: [], errors: [{ message: err.message }] };
  }
  return { outputs: [], errors: [{ message: 'This file could not be read as a font.' }] };
}

export default defineTool({
  id: 'font-inspector',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  autoRun: false,
  cancellable: true,
  runLimit: { ms: FONT_INSPECTOR_TIME_LIMIT_MS },
  fields: [
    {
      name: 'file',
      label: 'Open a font file',
      type: 'file',
      accept: '.ttf,.otf,.woff,.woff2,.ttc,.otc',
      help: `Up to ${MAX_FILE_BYTES / 1_048_576} MiB. The font is read here and nothing is uploaded.`,
    },
    {
      name: 'member',
      label: 'Font number in a collection',
      type: 'number',
      default: 1,
      min: 1,
      max: MAX_MEMBER,
      step: 1,
      help: 'Only used when the file is a collection of fonts.',
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    try {
      const member = num(values, 'member', 1);
      if (!Number.isInteger(member) || member < 1 || member > MAX_MEMBER) {
        return {
          outputs: [],
          errors: [{ message: `Font number in a collection must be a whole number from 1 to ${MAX_MEMBER}.` }],
        };
      }
      const picked = files(values, 'file');
      if (picked.length === 0) return { outputs: [] };
      const file = picked[0]!;
      // The size comes from the file object, so an oversized file is refused before any of it is read.
      checkFileSize(file.size);
      const bytes = new Uint8Array(await file.arrayBuffer());
      // An edit made while the file was being read has started a newer run; this one leaves nothing behind.
      if (ctx.signal.aborted) return { outputs: [] };
      const container = readContainer(bytes);
      let sfnt: Uint8Array = bytes;
      let wrapper: FontInspectorWrapper | null = null;
      if (container.kind === 'woff' || container.kind === 'woff2') {
        // WOFF and WOFF2 are unpacked in a background worker that can be cancelled and is stopped at 60 seconds.
        const result = await fontInspectorInWorker(
          { type: 'font-inspector-job', bytes, container: container.kind },
          ctx,
        );
        sfnt = result.sfnt;
        wrapper = result.wrapper;
      }
      return { outputs: outputsOf(inspectFont(sfnt, { member }), wrapper) };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return failure(err);
    }
  },
});
