import { FontInspectorError } from './errors';
import { readMetrics, type Metrics } from './metrics';
import { NAME_ID_LABELS, pickName, readNameTable, type NameRecord, type NameTable } from './names';
import { readContainer, readSfntFont, type ContainerKind, type SfntFont } from './sfnt';

export interface InspectOptions {
  /** The font to open in a collection, counting from 1. */
  member?: number;
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
  tables: TableRow[];
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

/**
 * Reads one font of an sfnt (or collection) into plain data. A table that is missing or damaged does not stop the
 * report: the rest is read and a note says what could not be.
 */
export function inspectFont(sfnt: Uint8Array, options: InspectOptions): FontReport {
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

  const metrics = readMetrics(sfnt, font);

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

  if (!font.tables.has('cmap')) {
    notes.push({ tone: 'warn', text: 'This font has no cmap table, so it maps no characters to glyphs.' });
  }

  let outlineFormat: FontReport['font']['outlineFormat'] = 'none';
  if (font.tables.has('glyf')) outlineFormat = 'TrueType';
  else if (font.tables.has('CFF ')) outlineFormat = 'CFF';
  else if (font.tables.has('CFF2')) outlineFormat = 'CFF2';

  const nameLabels = [...NAME_ID_LABELS].map(([id, label]) => ({ id, label }));
  const tables: TableRow[] = font.order.map((tag) => {
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

  const head = metrics.head;
  return {
    container: { kind: container.kind, fileSize: container.fileSize, memberCount: container.memberCount, member },
    font: {
      family: pickName(nameTable, 16) ?? pickName(nameTable, 1) ?? '',
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
    nameLabels,
    licence,
    metrics,
    tables,
    notes,
  };
}
