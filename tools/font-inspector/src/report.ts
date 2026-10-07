import { blockCoverage, checkSample, type Coverage, type SampleResult } from './coverage';
import { readCmap, type CmapSubtable, type VariationSelector } from './cmap';
import { FontInspectorError } from './errors';
import { describeFeature } from './feature-tags';
import { readFeatures } from './features';
import { buildGrid, checkGridOptions, openFontGlyphs, type Grid } from './grid';
import { describeEmbedding, readMetrics, verticalMetricsNote, type Embedding, type Metrics } from './metrics';
import { NAME_ID_LABELS, pickName, readNameTable, type NameRecord, type NameTable } from './names';
import { readContainer, readSfntFont, type ContainerKind, type SfntFont } from './sfnt';
import { readVariations, type Axis, type Instance } from './variations';

export interface InspectOptions {
  /** The font to open in a collection, counting from 1. */
  member?: number;
  /** The first glyph drawn in the grid (0 to 65534) and how many (1 to 512, 256 when left out). */
  glyphStart?: number;
  glyphCount?: number;
  /** Text to check against the font's character map (up to 10,000 characters). */
  sample?: string;
}

export interface ReportNote {
  /** 'info' for a plain fact, 'warn' for something the visitor should look at. */
  tone: 'info' | 'warn';
  text: string;
}

export interface TableRow {
  tag: string;
  offset: number;
  length: number;
  /** True when the table lies inside the file. */
  inFile: boolean;
  /** Whether the directory's checksum matches the table; null when the table is not inside the file. */
  checksumOk: boolean | null;
  /** What the table holds, in the project's own words ('' for a tag this page does not know). */
  description: string;
}

export interface LicenceText {
  id: number;
  label: string;
  platform: number;
  encoding: number;
  languageLabel: string;
  text: string;
}

export interface FeatureRow {
  tag: string;
  /** What the feature does, '' for a tag the registry does not name. */
  description: string;
  /** The layout tables that list it. */
  tables: ('GSUB' | 'GPOS')[];
  /** The script and language systems that use it, as `script/language`. */
  uses: string[];
}

export interface FontReport {
  container: { kind: ContainerKind; fileSize: number; memberCount: number; member: number };
  font: {
    family: string;
    subfamily: string;
    fullName: string;
    postScriptName: string;
    version: string;
    uniqueId: string;
    glyphCount: number | null;
    unitsPerEm: number | null;
    outlineFormat: 'TrueType' | 'CFF' | 'CFF2' | 'none';
    fontRevision: number | null;
    created: string | null;
    modified: string | null;
  };
  names: NameRecord[];
  nameLabels: { id: number; label: string }[];
  licence: LicenceText[];
  metrics: Metrics;
  embedding: Embedding | null;
  verticalMetricsNote: string | null;
  tables: TableRow[];
  features: FeatureRow[];
  axes: Axis[];
  instances: Instance[];
  instanceCount: number;
  cmapSubtables: CmapSubtable[];
  variationSelectors: VariationSelector[];
  coverage: Coverage;
  sample: SampleResult | null;
  grid: Grid;
  notes: ReportNote[];
}

/** What the tables a font usually holds are for, in the project's own words. */
const TABLE_DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
  ['cmap', 'Maps characters to glyphs'],
  ['head', 'Font header: units per em, bounds, revision'],
  ['hhea', 'Horizontal layout header'],
  ['hmtx', 'Horizontal advance widths and side bearings'],
  ['maxp', 'Glyph count and size limits'],
  ['name', 'Names, licence text and other strings'],
  ['OS/2', 'Weight, width, embedding flags and vertical metrics'],
  ['post', 'Glyph names and PostScript data'],
  ['glyf', 'TrueType glyph outlines'],
  ['loca', 'Where each TrueType glyph starts'],
  ['CFF ', 'PostScript glyph outlines (CFF)'],
  ['CFF2', 'PostScript glyph outlines for variable fonts (CFF2)'],
  ['GSUB', 'Glyph substitution features such as ligatures'],
  ['GPOS', 'Glyph positioning features such as kerning'],
  ['GDEF', 'Glyph classes and caret positions'],
  ['kern', 'Old-style kerning pairs'],
  ['fvar', 'Variable font axes and named instances'],
  ['gvar', 'Variable font outline changes'],
  ['avar', 'Variable font axis mapping'],
  ['STAT', 'Style attributes'],
  ['cvt ', 'Hinting control values'],
  ['fpgm', 'Hinting font program'],
  ['prep', 'Hinting setup program'],
  ['gasp', 'When to smooth and grid-fit'],
  ['DSIG', 'Digital signature'],
  ['COLR', 'Colour glyph layers'],
  ['CPAL', 'Colour palettes'],
  ['SVG ', 'Glyphs drawn as SVG'],
  ['sbix', 'Bitmap glyphs (Apple)'],
  ['CBDT', 'Colour bitmap glyph data'],
  ['CBLC', 'Colour bitmap glyph locations'],
  ['EBDT', 'Bitmap glyph data'],
  ['EBLC', 'Bitmap glyph locations'],
  ['MATH', 'Maths layout'],
  ['BASE', 'Baselines for scripts'],
  ['JSTF', 'Justification'],
  ['vhea', 'Vertical layout header'],
  ['vmtx', 'Vertical metrics'],
  ['VORG', 'Vertical origins'],
  ['HVAR', 'Variable font horizontal metric changes'],
  ['MVAR', 'Variable font metric changes'],
  ['VVAR', 'Variable font vertical metric changes'],
  ['cvar', 'Variable font hinting value changes'],
  ['meta', 'Metadata'],
  ['LTSH', 'Linear threshold data'],
  ['hdmx', 'Device metrics'],
  ['PCLT', 'PCL 5 data'],
  ['VDMX', 'Vertical device metrics'],
]);

const NO_FONT_SENTENCE = 'This is a WOFF or WOFF2 file; it has to be unpacked before it can be read.';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * Reads one font of an sfnt (or collection) into plain data: names and licence text, metrics and embedding flags, the
 * tables, layout features, variable axes, coverage by Unicode block, the sample check and the glyph grid. A table that is
 * missing or damaged does not stop the report: the rest is read and a note says what could not be. A field that is outside
 * its range (the font number, the first glyph, the number of glyphs, the sample length) is refused naming the field.
 */
export function inspectFont(sfnt: Uint8Array, options: InspectOptions): FontReport {
  const grid = checkGridOptions({ start: options.glyphStart, count: options.glyphCount });
  const container = readContainer(sfnt);
  if (container.kind === 'woff' || container.kind === 'woff2') {
    throw new FontInspectorError(NO_FONT_SENTENCE, 'File');
  }
  const member = options.member ?? 1;
  if (!Number.isInteger(member) || member < 1 || member > container.memberCount) {
    throw new FontInspectorError(
      `This file holds ${container.memberCount} font${container.memberCount === 1 ? '' : 's'}; pick a font number from 1 to ${container.memberCount}.`,
      'Font number in a collection',
    );
  }
  const offset = container.memberOffsets[member - 1];
  if (offset === undefined) {
    throw new FontInspectorError('That font is not listed in the collection.', 'Font number in a collection');
  }
  const font: SfntFont = readSfntFont(sfnt, offset, container.kind === 'collection');
  const notes: ReportNote[] = [];
  for (const n of container.notes) notes.push({ tone: 'info', text: n });
  for (const n of font.notes) notes.push({ tone: 'info', text: n });

  // Checksums and table ranges.
  const tables = font.order.map((tag) => font.tables.get(tag)!);
  const outside = tables.filter((t) => !t.inFile).length;
  const wrongSums = tables.filter((t) => t.checksumOk === false).length;
  if (outside > 0) {
    notes.push({
      tone: 'warn',
      text: plural(
        outside,
        'One table lies outside the file and is not read.',
        `${outside} tables lie outside the file and are not read.`,
      ),
    });
  }
  if (wrongSums > 0) {
    notes.push({
      tone: 'warn',
      text: plural(
        wrongSums,
        'One table has a checksum that does not match its bytes.',
        `${wrongSums} tables have a checksum that does not match their bytes.`,
      ),
    });
  }
  if (font.wholeFileOk === false) {
    notes.push({
      tone: 'warn',
      text: 'The whole-file checksum does not match the checksum adjustment in the head table.',
    });
  }

  const metrics = readMetrics(sfnt, font);
  if (!metrics.head)
    notes.push({ tone: 'warn', text: 'This font has no usable head table, so its units per em are unknown.' });
  if (metrics.numGlyphs === null)
    notes.push({ tone: 'warn', text: 'This font has no usable maxp table, so its glyph count is unknown.' });
  if (!metrics.os2)
    notes.push({ tone: 'info', text: 'This font has no OS/2 table, so it states no embedding flags or weight.' });

  // Names.
  let nameTable: NameTable | null = null;
  const nameEntry = font.tables.get('name');
  if (!nameEntry) {
    notes.push({ tone: 'warn', text: 'This font has no name table, so it shows no names or licence text.' });
  } else if (!nameEntry.inFile) {
    notes.push({ tone: 'warn', text: 'The name table of this font lies outside the file, so it shows no names.' });
  } else {
    nameTable = readNameTable(sfnt, nameEntry.offset, nameEntry.length);
    for (const n of nameTable.notes) notes.push({ tone: 'info', text: n });
  }
  const names = nameTable ? nameTable.records : [];
  const licence: LicenceText[] = [];
  for (const record of names) {
    if ((record.id === 13 || record.id === 14) && record.text !== null && record.text !== '') {
      licence.push({
        id: record.id,
        label: NAME_ID_LABELS.get(record.id) ?? '',
        platform: record.platform,
        encoding: record.encoding,
        languageLabel: record.languageLabel,
        text: record.text,
      });
    }
  }

  // Character map.
  const cmapEntry = font.tables.get('cmap');
  let cmapMap: ReadonlyMap<number, number> = new Map();
  let cmapSubtables: CmapSubtable[] = [];
  let variationSelectors: VariationSelector[] = [];
  if (!cmapEntry) {
    notes.push({ tone: 'warn', text: 'This font has no cmap table, so it maps no characters to glyphs.' });
  } else if (cmapEntry.inFile) {
    const cmap = readCmap(sfnt, cmapEntry.offset, cmapEntry.length);
    cmapMap = cmap.map;
    cmapSubtables = cmap.subtables;
    variationSelectors = cmap.variationSelectors;
    for (const n of cmap.notes) notes.push({ tone: 'info', text: n });
  }
  const coverage = blockCoverage(cmapMap.keys());
  const sample = options.sample !== undefined && options.sample !== '' ? checkSample(options.sample, cmapMap) : null;

  // Layout features.
  const gsub = readFeatures(sfnt, font.tables.get('GSUB'));
  const gpos = readFeatures(sfnt, font.tables.get('GPOS'));
  for (const table of [gsub, gpos]) if (table) for (const n of table.notes) notes.push({ tone: 'info', text: n });
  const featureMap = new Map<string, { tables: Set<'GSUB' | 'GPOS'>; uses: Set<string> }>();
  for (const [name, table] of [
    ['GSUB', gsub],
    ['GPOS', gpos],
  ] as const) {
    if (!table) continue;
    for (const tag of table.tags) {
      let row = featureMap.get(tag);
      if (!row) {
        row = { tables: new Set(), uses: new Set() };
        featureMap.set(tag, row);
      }
      row.tables.add(name);
      for (const use of table.uses.get(tag) ?? []) row.uses.add(use);
    }
  }
  const features: FeatureRow[] = [...featureMap]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([tag, row]) => ({
      tag,
      description: describeFeature(tag),
      tables: [...row.tables].sort(),
      uses: [...row.uses].sort(),
    }));

  // Variable axes.
  const variations = readVariations(sfnt, font.tables.get('fvar'), nameTable);
  if (variations) for (const n of variations.notes) notes.push({ tone: 'info', text: n });

  // Outlines and the glyph grid.
  let outlineFormat: FontReport['font']['outlineFormat'] = 'none';
  if (font.tables.has('glyf')) outlineFormat = 'TrueType';
  else if (font.tables.has('CFF ')) outlineFormat = 'CFF';
  else if (font.tables.has('CFF2')) outlineFormat = 'CFF2';
  if (outlineFormat === 'none')
    notes.push({ tone: 'info', text: 'This font has no glyf or CFF table, so there are no outlines to draw.' });
  if (outlineFormat === 'CFF2')
    notes.push({ tone: 'info', text: 'The outlines of a variable CFF2 font are not drawn.' });
  if (outlineFormat === 'TrueType' && !font.tables.has('loca')) {
    notes.push({
      tone: 'warn',
      text: 'This font has a glyf table but no loca table, so its outlines cannot be found.',
    });
  }

  // The directory read above is used again, so a font's tables are summed once per report.
  const source = openFontGlyphs(sfnt, font);
  const wanted = new Set<number>();
  for (let g = grid.start; g < Math.min(source.count, grid.start + grid.count); g++) wanted.add(g);
  const codePointsOf = new Map<number, number[]>();
  for (const [code, glyph] of cmapMap) {
    if (!wanted.has(glyph)) continue;
    const list = codePointsOf.get(glyph);
    if (list) list.push(code);
    else codePointsOf.set(glyph, [code]);
  }
  for (const list of codePointsOf.values()) list.sort((a, b) => a - b);

  const head = metrics.head;
  const family = pickName(nameTable, 16) ?? pickName(nameTable, 1) ?? '';
  const glyphGrid = buildGrid(source, grid, {
    unitsPerEm: head ? head.unitsPerEm : 1000,
    ascent: metrics.hhea ? metrics.hhea.ascent : head ? head.unitsPerEm * 0.8 : 800,
    descent: metrics.hhea ? metrics.hhea.descent : head ? -head.unitsPerEm * 0.2 : -200,
    codePointsOf,
    family,
  });
  if (glyphGrid.rows.some((r) => r.unreadable)) {
    notes.push({ tone: 'warn', text: 'Some glyphs could not be read from the outline data, and are drawn empty.' });
  }
  if (glyphGrid.rows.some((r) => r.truncated)) {
    notes.push({
      tone: 'info',
      text: 'Some glyphs are drawn only in part because they pass a limit on points, components or depth.',
    });
  }

  const tableRows: TableRow[] = font.order.map((tag) => {
    const entry = font.tables.get(tag)!;
    return {
      tag,
      offset: entry.offset,
      length: entry.length,
      inFile: entry.inFile,
      checksumOk: entry.checksumOk,
      description: TABLE_DESCRIPTIONS.get(tag) ?? '',
    };
  });

  return {
    container: { kind: container.kind, fileSize: container.fileSize, memberCount: container.memberCount, member },
    font: {
      family,
      subfamily: pickName(nameTable, 17) ?? pickName(nameTable, 2) ?? '',
      fullName: pickName(nameTable, 4) ?? '',
      postScriptName: pickName(nameTable, 6) ?? '',
      version: pickName(nameTable, 5) ?? '',
      uniqueId: pickName(nameTable, 3) ?? '',
      glyphCount: metrics.numGlyphs,
      unitsPerEm: head ? head.unitsPerEm : null,
      outlineFormat,
      fontRevision: head ? head.fontRevision : null,
      created: head ? head.created : null,
      modified: head ? head.modified : null,
    },
    names,
    nameLabels: [...NAME_ID_LABELS].map(([id, label]) => ({ id, label })),
    licence,
    metrics,
    embedding: metrics.os2 ? describeEmbedding(metrics.os2.fsType) : null,
    verticalMetricsNote: verticalMetricsNote(metrics),
    tables: tableRows,
    features,
    axes: variations ? variations.axes : [],
    instances: variations ? variations.instances : [],
    instanceCount: variations ? variations.instanceCount : 0,
    cmapSubtables,
    variationSelectors,
    coverage,
    sample,
    grid: glyphGrid,
    notes,
  };
}
