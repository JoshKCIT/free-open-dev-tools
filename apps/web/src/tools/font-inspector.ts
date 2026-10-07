import {
  DEFAULT_GLYPHS_PER_GRID,
  FontInspectorError,
  MAX_FILE_BYTES,
  MAX_GLYPHS_PER_GRID,
  MAX_GLYPH_START,
  MAX_LICENCE_CHARS,
  MAX_NAME_CELL_CHARS,
  MAX_SAMPLE_CHARS,
  checkFileSize,
  checkGridOptions,
  conversionRefusal,
  inspectFont,
  meta,
  readContainer,
  restrictsEmbedding,
  visible,
  type ConversionReport,
  type ConvertTarget,
  type FontReport,
} from '@fodt/font-inspector';
import {
  FONT_INSPECTOR_TIME_LIMIT_MS,
  FontInspectorRunError,
  fontInspectorInWorker,
  type FontInspectorConversion,
  type FontInspectorWrapper,
} from '../lib/run-font-inspector-in-worker';
import { defineTool, files, num, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** What the page says first: where the font is read and what the page never does with it. */
const FIRST_NOTE =
  'The font is read and converted on this device and nothing is uploaded. No address inside the font (a licence or vendor address) is ever requested; such an address is shown as text only.';

const MAX_NAME_ROWS_SHOWN = 500;
const MAX_FEATURE_ROWS_SHOWN = 500;
const MAX_USES_SHOWN = 6;
const MAX_MEMBER = 100;

const PLATFORMS: readonly string[] = ['Unicode', 'Macintosh', 'ISO', 'Windows'];

const count = (value: number): string => value.toLocaleString('en-US');

const hex = (value: number): string => `U+${value.toString(16).toUpperCase().padStart(4, '0')}`;

/** A name or other text from the font, safe to show in a table cell: hidden and direction-changing characters are written out. */
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
  // The licence description and the licence address in full, one block each, as text and never as a link.
  for (const licence of report.licence) {
    const where = `${PLATFORMS[licence.platform] ?? `Platform ${licence.platform}`}, ${licence.languageLabel}`;
    out.push({ kind: 'code', label: `${licence.label} (${where})`, value: visible(licence.text, MAX_LICENCE_CHARS) });
  }
  return out;
}

function metricsBlocks(report: FontReport): OutputBlock[] {
  const pairs: [string, string][] = [];
  const e = report.embedding;
  if (e) {
    pairs.push(['Embedding flags (fsType)', `${e.fsType} (0x${e.fsType.toString(16).toUpperCase().padStart(4, '0')})`]);
    pairs.push(['What the flags say', e.permission]);
    pairs.push(['Subsetting', e.noSubsetting ? 'The flags ask that the font is not subset' : 'No restriction stated']);
    pairs.push(['Bitmap embedding', e.bitmapOnly ? 'The flags allow bitmap embedding only' : 'No restriction stated']);
  }
  const { head, hhea, os2, post } = report.metrics;
  if (head) {
    pairs.push(['Units per em', count(head.unitsPerEm)]);
    pairs.push(['Font revision', String(head.fontRevision)]);
    if (head.created) pairs.push(['Created', head.created]);
    if (head.modified) pairs.push(['Modified', head.modified]);
    pairs.push(['Bounding box', `${head.xMin}, ${head.yMin} to ${head.xMax}, ${head.yMax}`]);
  }
  if (hhea) {
    pairs.push(['Ascent (hhea)', String(hhea.ascent)]);
    pairs.push(['Descent (hhea)', String(hhea.descent)]);
    pairs.push(['Line gap (hhea)', String(hhea.lineGap)]);
  }
  if (os2) {
    pairs.push([
      'Typographic ascender, descender and gap',
      `${os2.typoAscender}, ${os2.typoDescender}, ${os2.typoLineGap}`,
    ]);
    pairs.push(['Windows ascent and descent', `${os2.winAscent}, ${os2.winDescent}`]);
    if (os2.xHeight !== null) pairs.push(['x-height', String(os2.xHeight)]);
    if (os2.capHeight !== null) pairs.push(['Cap height', String(os2.capHeight)]);
    pairs.push(['Weight class', String(os2.weightClass)]);
    pairs.push(['Width class', String(os2.widthClass)]);
    pairs.push(['Vendor ID', shown(os2.vendor)]);
  }
  if (post) {
    pairs.push(['Italic angle', String(post.italicAngle)]);
    pairs.push(['Fixed pitch', post.isFixedPitch ? 'Yes' : 'No']);
  }
  if (pairs.length === 0) return [];
  const out: OutputBlock[] = [{ kind: 'keyvalue', label: 'Embedding and metrics', pairs }];
  if (report.verticalMetricsNote) out.push({ kind: 'note', tone: 'info', value: report.verticalMetricsNote });
  return out;
}

function tablesBlock(report: FontReport): OutputBlock {
  const rows = report.tables.map((t) => [
    shown(t.tag),
    t.inFile ? count(t.offset) : 'outside the file',
    count(t.length),
    t.checksumOk === null ? 'not checked' : t.checksumOk ? 'matches' : 'does not match',
    t.description,
  ]);
  return {
    kind: 'table',
    label: 'Tables',
    table: { headers: ['Tag', 'Offset', 'Length', 'Checksum', 'What it holds'], rows, mono: [0, 1, 2] },
  };
}

function featureBlocks(report: FontReport): OutputBlock[] {
  if (report.features.length === 0) return [];
  const rows = report.features.slice(0, MAX_FEATURE_ROWS_SHOWN).map((f) => {
    const uses = f.uses.slice(0, MAX_USES_SHOWN).map((u) => shown(u));
    const more = f.uses.length > MAX_USES_SHOWN ? ` and ${count(f.uses.length - MAX_USES_SHOWN)} more` : '';
    return [
      shown(f.tag),
      f.tables.join(', '),
      f.description === '' ? 'Not in the registry' : f.description,
      uses.join(', ') + more,
    ];
  });
  const out: OutputBlock[] = [
    {
      kind: 'table',
      label: 'OpenType features',
      table: { headers: ['Tag', 'Table', 'What it does', 'Used by (script/language)'], rows, mono: [0] },
    },
  ];
  if (report.features.length > MAX_FEATURE_ROWS_SHOWN) {
    out.push({
      kind: 'note',
      tone: 'info',
      value: `The table shows the first ${count(MAX_FEATURE_ROWS_SHOWN)} of ${count(report.features.length)} features.`,
    });
  }
  return out;
}

function variationBlocks(report: FontReport): OutputBlock[] {
  if (report.axes.length === 0) return [];
  const out: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Variable axes',
      table: {
        headers: ['Tag', 'Name', 'Minimum', 'Default', 'Maximum'],
        rows: report.axes.map((a) => [shown(a.tag), a.name === '' ? '' : shown(a.name), a.min, a.default, a.max]),
        mono: [0],
      },
    },
  ];
  if (report.instances.length > 0) {
    out.push({
      kind: 'table',
      label: 'Named instances',
      table: {
        headers: ['Name', 'Coordinates'],
        rows: report.instances.map((i) => [
          i.name === '' ? `name ID ${i.nameId}` : shown(i.name),
          i.coordinates.map((c) => `${shown(c.tag)} ${c.value}`).join(', '),
        ]),
      },
    });
  }
  if (report.instanceCount > report.instances.length) {
    out.push({
      kind: 'note',
      tone: 'info',
      value: `The table shows ${count(report.instances.length)} of ${count(report.instanceCount)} named instances.`,
    });
  }
  return out;
}

function coverageBlocks(report: FontReport): OutputBlock[] {
  const c = report.coverage;
  if (c.total === 0) return [];
  const rows = c.blocks.map((b) => [
    b.name,
    `${hex(b.first)} to ${hex(b.last)}`,
    count(b.covered),
    count(b.size),
    `${((b.covered / b.size) * 100).toFixed(1)}%`,
  ]);
  const out: OutputBlock[] = [
    {
      kind: 'table',
      label: `Coverage by Unicode block (Unicode ${c.unicodeVersion})`,
      table: { headers: ['Block', 'Range', 'Characters covered', 'Block size', 'Share'], rows, mono: [1] },
    },
  ];
  const total = `${count(c.total)} characters are mapped to a glyph in all.`;
  out.push({
    kind: 'note',
    tone: 'info',
    value:
      c.outsideBlocks > 0 ? `${total} ${count(c.outsideBlocks)} of them lie outside every block of the list.` : total,
  });
  return out;
}

function sampleBlocks(report: FontReport): OutputBlock[] {
  const s = report.sample;
  if (!s) return [];
  const out: OutputBlock[] = [
    {
      kind: 'keyvalue',
      label: 'Sample text',
      pairs: [
        ['Characters', count(s.characters)],
        ['Different characters', count(s.distinct)],
        ['In this font', count(s.coveredDistinct)],
        ['Not in this font', count(s.missingCount)],
      ],
    },
  ];
  if (s.missingCount > 0) {
    out.push({
      kind: 'list',
      label: 'Not in this font',
      items: s.missing.map((m) => `${hex(m.codePoint)} ${visible(m.text, 8)}`),
    });
    if (s.missingCount > s.missing.length) {
      out.push({
        kind: 'note',
        tone: 'info',
        value: `The list shows the first ${count(s.missing.length)} of ${count(s.missingCount)} missing characters.`,
      });
    }
  } else if (s.distinct > 0) {
    out.push({
      kind: 'note',
      tone: 'success',
      value: 'Every character of the sample is mapped to a glyph in this font.',
    });
  }
  return out;
}

function gridBlocks(report: FontReport): OutputBlock[] {
  const g = report.grid;
  const out: OutputBlock[] = [];
  if (g.shown > 0) {
    out.push({ kind: 'image', label: 'Glyph grid', src: g.dataAddress, alt: g.alt, width: g.width, height: g.height });
  }
  if (g.note) out.push({ kind: 'note', tone: 'info', value: g.note });
  if (g.rows.length > 0) {
    const rows = g.rows.map((r) => [
      r.id,
      r.name === '' ? '' : shown(r.name),
      r.codePoints,
      r.points,
      r.unreadable ? 'could not be read' : r.truncated ? 'drawn in part' : r.empty ? 'no outline' : '',
    ]);
    out.push({
      kind: 'table',
      label: `Glyphs shown (${count(g.start)} to ${count(g.start + g.shown - 1)})`,
      table: { headers: ['Glyph', 'Name', 'Code points', 'Points', 'Note'], rows, mono: [1, 2] },
    });
  }
  return out;
}

/** What the visitor asked for in the conversion field and what became of it. */
interface ConversionOutcome {
  target: ConvertTarget | 'none';
  /** The reason the conversion was refused before it ran, in plain words. */
  refusal: string | null;
  conversion: FontInspectorConversion | null;
}

const TARGET_NAMES: Record<ConvertTarget, string> = {
  sfnt: 'a TrueType or OpenType file',
  woff: 'a WOFF file',
  woff2: 'a WOFF2 file',
};

/** The select's value as a target; anything else means no conversion. */
function targetOf(value: string): ConvertTarget | 'none' {
  return value === 'sfnt' || value === 'woff' || value === 'woff2' ? value : 'none';
}

function checkPairs(report: ConversionReport, target: ConvertTarget): [string, string][] {
  const pairs: [string, string][] = [
    [
      'Result',
      report.ok
        ? 'Read back and checked: no difference found beyond what the format changes'
        : 'Not offered: the check found a problem',
    ],
    ['Converted to', TARGET_NAMES[target]],
    ['Tables byte for byte identical', `${count(report.tablesIdentical)} of ${count(report.tablesTotal)}`],
    ['Glyphs compared', count(report.glyphsCompared)],
  ];
  for (const text of report.byDesign) {
    const colon = text.indexOf(': ');
    pairs.push(
      colon > 0 ? [`Differs by design: ${text.slice(0, colon)}`, text.slice(colon + 2)] : ['Differs by design', text],
    );
  }
  if (report.byDesign.length === 0 && report.ok) pairs.push(['Differs by design', 'Nothing']);
  return pairs;
}

/** The conversion's blocks: the warning about the font's own flags, the check, the file, or the reason there is none. */
function conversionBlocks(report: FontReport, outcome: ConversionOutcome): OutputBlock[] {
  if (outcome.target === 'none') return [];
  const out: OutputBlock[] = [];
  const e = report.embedding;
  if (e && restrictsEmbedding(e)) {
    out.push({
      kind: 'note',
      tone: 'warn',
      value: `This font's own flags say: ${e.permission}. They are the font maker's statement and this page cannot tell you what you may do with a converted file; read the licence before you publish it.`,
    });
  }
  if (outcome.refusal !== null) {
    out.push({ kind: 'note', tone: 'warn', value: `Not converted. ${outcome.refusal}` });
    return out;
  }
  const done = outcome.conversion;
  if (!done) return out;
  out.push({ kind: 'keyvalue', label: 'Conversion check', pairs: checkPairs(done.report, done.target) });
  if (done.report.ok && done.bytes !== null && done.name !== null) {
    out.push({
      kind: 'note',
      tone: 'success',
      value:
        'Only the container and its compression changed. The outlines, hinting, features, names and metrics are carried over unchanged, and the file was read back and checked before it was offered.',
    });
    out.push({
      kind: 'files',
      label: 'Converted font',
      files: [{ name: done.name, mime: 'application/octet-stream', content: done.bytes }],
    });
  } else {
    out.push({
      kind: 'note',
      tone: 'warn',
      value: 'The converted file was not offered, because reading it back found a problem.',
    });
    out.push({ kind: 'list', label: 'What the check found', items: done.report.problems });
  }
  return out;
}

function outputsOf(
  report: FontReport,
  wrapper: FontInspectorWrapper | null,
  outcome: ConversionOutcome,
): OutputBlock[] {
  const outputs: OutputBlock[] = [{ kind: 'note', tone: 'info', value: FIRST_NOTE }];
  for (const note of report.notes) outputs.push({ kind: 'note', tone: note.tone, value: note.text });
  if (wrapper) for (const text of wrapper.notes) outputs.push({ kind: 'note', tone: 'info', value: text });
  // The conversion comes straight after the notes, so a visitor who asked for one sees its result without scrolling past
  // the whole report.
  outputs.push(...conversionBlocks(report, outcome));
  outputs.push(fontBlock(report, wrapper));
  outputs.push(...namesBlocks(report));
  outputs.push(...metricsBlocks(report));
  outputs.push(tablesBlock(report));
  outputs.push(...featureBlocks(report));
  outputs.push(...variationBlocks(report));
  outputs.push(...coverageBlocks(report));
  outputs.push(...sampleBlocks(report));
  outputs.push(...gridBlocks(report));
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
      name: 'convertTo',
      label: 'Convert to',
      type: 'select',
      default: 'none',
      options: [
        { value: 'none', label: 'Inspect only' },
        { value: 'sfnt', label: 'TrueType or OpenType file' },
        { value: 'woff', label: 'WOFF' },
        { value: 'woff2', label: 'WOFF2' },
      ],
      help: 'Only the container and its compression change. The converted file is read back and checked before it is offered.',
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
    {
      name: 'glyphStart',
      label: 'First glyph',
      type: 'number',
      default: 0,
      min: 0,
      max: MAX_GLYPH_START,
      step: 1,
      help: 'The glyph number the grid starts at.',
    },
    {
      name: 'glyphCount',
      label: 'Glyphs to draw',
      type: 'number',
      default: DEFAULT_GLYPHS_PER_GRID,
      min: 1,
      max: MAX_GLYPHS_PER_GRID,
      step: 1,
      help: `How many glyphs the grid draws, up to ${MAX_GLYPHS_PER_GRID}.`,
    },
    {
      name: 'sample',
      label: 'Check these characters',
      type: 'text',
      placeholder: 'Characters to look for in the font',
      help: `Up to ${count(MAX_SAMPLE_CHARS)} characters. Shows which of them the font has and which it lacks.`,
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
      const glyphStart = num(values, 'glyphStart', 0);
      const glyphCount = num(values, 'glyphCount', DEFAULT_GLYPHS_PER_GRID);
      // The two grid fields are checked before anything is read, and the refusal names the field that is wrong.
      checkGridOptions({ start: glyphStart, count: glyphCount });
      const picked = files(values, 'file');
      if (picked.length === 0) return { outputs: [] };
      const file = picked[0]!;
      // The size comes from the file object, so an oversized file is refused before any of it is read.
      checkFileSize(file.size);
      const bytes = new Uint8Array(await file.arrayBuffer());
      // An edit made while the file was being read has started a newer run; this one leaves nothing behind.
      if (ctx.signal.aborted) return { outputs: [] };
      const container = readContainer(bytes);
      // A conversion that cannot run (a collection, a file already in the target's container) is said so in plain words and
      // the font is still read; one that can run goes to the background worker with the font.
      const target = targetOf(str(values, 'convertTo', 'none'));
      const early = target === 'none' ? null : conversionRefusal(container, target);
      const outcome: ConversionOutcome = { target, refusal: early, conversion: null };
      const converting = target !== 'none' && early === null;
      let sfnt: Uint8Array = bytes;
      let wrapper: FontInspectorWrapper | null = null;
      if (container.kind === 'woff' || container.kind === 'woff2' || converting) {
        // WOFF and WOFF2 are unpacked, and a conversion is made and checked, in a background worker that can be cancelled
        // and is stopped at 60 seconds.
        const result = await fontInspectorInWorker(
          {
            type: 'font-inspector-job',
            bytes,
            container: container.kind === 'woff' || container.kind === 'woff2' ? container.kind : 'sfnt',
            convertTo: converting ? target : 'none',
            fileName: file.name,
          },
          ctx,
        );
        sfnt = result.sfnt;
        wrapper = result.wrapper;
        outcome.conversion = result.conversion;
        if (result.refusal !== null) outcome.refusal = result.refusal;
      }
      const report = inspectFont(sfnt, { member, glyphStart, glyphCount, sample: str(values, 'sample') });
      return { outputs: outputsOf(report, wrapper, outcome) };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return failure(err);
    }
  },
});
