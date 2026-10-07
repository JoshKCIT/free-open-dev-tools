import { FontInspectorError } from './errors';
import { MAX_SFNT_BYTES } from './limits';
import { pickName, readNameTable, type NameTable } from './names';
import { readContainer, readSfntFont, withChecksumAdjustment, type Container, type SfntFont } from './sfnt';
import { unwrapWoff1, wrapWoff1 } from './woff1';
import { isCodeGenerationRefusal, unpackWoff2 } from './woff2';

/**
 * Converting a font between the three containers: a TrueType or OpenType file (an sfnt), WOFF 1.0 and WOFF2. Only the
 * container and its compression change. The font's tables are carried over untouched (WOFF2 stores the glyph table in its
 * own layout and writes it out again, which `verify.ts` compares glyph by glyph). The WOFF2 engine is never imported here:
 * the caller passes it in, so the package index stays free of it and only the background worker reaches it.
 */

export type ConvertTarget = 'sfnt' | 'woff' | 'woff2';

/** The two calls of the WOFF2 engine the conversion and its re-read check use. */
export interface ConvertEngine {
  woff2Compress(input: Uint8Array): Promise<Uint8Array>;
  woff2Decompress(input: Uint8Array): Promise<Uint8Array>;
}

export interface ConvertJob {
  /** The whole opened file. */
  bytes: Uint8Array;
  target: ConvertTarget;
  /** The opened file's name, used for the saved name only when the font has no usable name of its own. */
  fileName?: string | undefined;
}

export interface ConvertedFont {
  /** The converted file. */
  bytes: Uint8Array;
  target: ConvertTarget;
  /** The cleaned name to save it under, with the target's extension. */
  name: string;
  /** The font as a plain sfnt, as it was before the conversion (what the re-read check compares with). */
  sfnt: Uint8Array;
}

const CODE_GENERATION_SENTENCE =
  'The browser did not allow this page to generate code at run time, which the WOFF2 engine needs, so the font could not be packed.';

const TARGET_LABEL: Record<ConvertTarget, string> = {
  sfnt: 'a TrueType or OpenType file',
  woff: 'a WOFF file',
  woff2: 'a WOFF2 file',
};

const sameContainer = (target: ConvertTarget): string =>
  `This file is already ${TARGET_LABEL[target]}, so there is nothing to convert. Choose another format.`;

/**
 * The reason a file is not converted to a target, or null when it can be: a collection is never converted (WOFF has no
 * collections and a packed collection does not read back to the same bytes), the file must be a TrueType or OpenType font
 * inside, and a file that is already in the target's container has nothing to convert.
 */
export function conversionRefusal(container: Container, target: ConvertTarget): string | null {
  if (container.kind === 'collection' || container.flavor === 'collection') {
    return 'A font collection is not converted: this page converts one font file at a time. A collection can still be read one font at a time.';
  }
  if (container.flavor === 'other') {
    return 'This font is not a TrueType or OpenType font, so it is not converted.';
  }
  if (container.kind === target) return sameContainer(target);
  return null;
}

const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Letters, digits, dots, underscores and hyphens only; nothing else survives, and the result is never a hidden name. */
export function cleanName(text: string): string {
  const kept = text.slice(0, 400).replace(/[^A-Za-z0-9._-]/g, '');
  // No leading dots (a hidden file), and not a name Windows keeps for devices.
  let stem = kept.replace(/^\.+/, '').slice(0, 100);
  if (RESERVED_WINDOWS.test(stem.split('.')[0] ?? '')) stem = `_${stem}`;
  return stem;
}

export interface OutputNames {
  postScriptName?: string | undefined;
  family?: string | undefined;
  subfamily?: string | undefined;
  /** True for a font with PostScript (CFF) outlines, which a TrueType or OpenType target names `.otf`. */
  cff?: boolean | undefined;
}

/**
 * The name a converted file is saved under: the PostScript name (name ID 6), else the family and style joined by a hyphen,
 * else the stem of the opened file, each cleaned to letters, digits, dots, underscores and hyphens, then the target's
 * extension (`.ttf` or `.otf` for a TrueType or OpenType target according to the outlines, `.woff`, `.woff2`). The first
 * source that leaves anything after cleaning wins; with none the stem is `font`.
 */
export function outputName(names: OutputNames, fileName: string | undefined, target: ConvertTarget): string {
  const candidates: string[] = [];
  if (names.postScriptName) candidates.push(names.postScriptName);
  if (names.family) candidates.push(names.subfamily ? `${names.family}-${names.subfamily}` : names.family);
  if (fileName) {
    const last = fileName.split(/[\\/]/).pop() ?? '';
    const dot = last.lastIndexOf('.');
    candidates.push(dot > 0 ? last.slice(0, dot) : last);
  }
  let stem = 'font';
  for (const candidate of candidates) {
    const cleaned = cleanName(candidate);
    if (cleaned !== '') {
      stem = cleaned;
      break;
    }
  }
  const extension = target === 'sfnt' ? (names.cff === true ? 'otf' : 'ttf') : target;
  return `${stem}.${extension}`;
}

function packFailure(err: unknown): FontInspectorError {
  if (err instanceof FontInspectorError) return err;
  if (isCodeGenerationRefusal(err)) return new FontInspectorError(CODE_GENERATION_SENTENCE, 'File');
  return new FontInspectorError(
    'This font could not be packed as WOFF2. It may be damaged, or hold a table the format cannot carry.',
    'File',
  );
}

function readNames(sfnt: Uint8Array, font: SfntFont): OutputNames {
  const entry = font.tables.get('name');
  let table: NameTable | null = null;
  if (entry && entry.inFile) {
    try {
      table = readNameTable(sfnt, entry.offset, entry.length);
    } catch {
      table = null;
    }
  }
  return {
    postScriptName: pickName(table, 6),
    family: pickName(table, 16) ?? pickName(table, 1),
    subfamily: pickName(table, 17) ?? pickName(table, 2),
    cff: font.flavor === 'cff',
  };
}

/**
 * Converts a font that is already a plain sfnt. `source` says which container it was unpacked from, because an sfnt made by
 * unwrapping a WOFF 1.0 file keeps the layout of the WOFF file, so its head table's checksum adjustment is set again for
 * the new file (an sfnt unpacked from WOFF2 already has it, set by the engine). The font is checked before anything is
 * written: at most 30 MiB (refused before the engine runs), a directory that lists every table once and keeps each inside
 * the file. Every failure is a `FontInspectorError`.
 */
export async function convertSfnt(
  job: { sfnt: Uint8Array; source: 'sfnt' | 'woff' | 'woff2'; target: ConvertTarget; fileName?: string | undefined },
  engine: ConvertEngine,
): Promise<ConvertedFont> {
  const { sfnt, source, target } = job;
  if (sfnt.length > MAX_SFNT_BYTES) {
    throw new FontInspectorError(
      'This font is larger than the 30 MiB this page converts. It was not converted.',
      'File',
    );
  }
  if (source === target) throw new FontInspectorError(sameContainer(target), 'File');
  const font = readSfntFont(sfnt, 0, false);
  if (font.flavor === 'other') {
    throw new FontInspectorError('This font is not a TrueType or OpenType font, so it is not converted.', 'File');
  }
  const listed = (sfnt[4]! << 8) | sfnt[5]!;
  if (font.order.length !== listed) {
    throw new FontInspectorError('This font lists the same table twice, so it is not converted.', 'File');
  }
  if (font.order.some((tag) => !font.tables.get(tag)!.inFile)) {
    throw new FontInspectorError('A table of this font lies outside the file, so the font is not converted.', 'File');
  }

  let bytes: Uint8Array;
  if (target === 'woff2') {
    let packed: unknown;
    try {
      packed = await engine.woff2Compress(sfnt);
    } catch (err) {
      throw packFailure(err);
    }
    if (!(packed instanceof Uint8Array) || packed.length < 48) {
      throw new FontInspectorError('This font could not be packed as WOFF2.', 'File');
    }
    bytes = packed.slice();
  } else if (target === 'woff') {
    bytes = wrapWoff1(sfnt);
  } else {
    bytes = source === 'woff' ? withChecksumAdjustment(sfnt) : sfnt.slice();
  }
  return { bytes, target, name: outputName(readNames(sfnt, font), job.fileName, target), sfnt };
}

/**
 * Converts an opened file: the container is recognised, a collection, a font that is not TrueType or OpenType and a file
 * already in the target's container are refused in plain words, a WOFF or WOFF2 input is unpacked under the usual caps
 * (the size checks first), and the plain sfnt is converted. The result carries the sfnt so the re-read check can compare
 * with it. Every failure is a `FontInspectorError`.
 */
export async function convertFont(job: ConvertJob, engine: ConvertEngine): Promise<ConvertedFont> {
  const container = readContainer(job.bytes);
  const refusal = conversionRefusal(container, job.target);
  if (refusal !== null) throw new FontInspectorError(refusal, 'File');
  let sfnt: Uint8Array;
  if (container.kind === 'woff') sfnt = unwrapWoff1(job.bytes);
  else if (container.kind === 'woff2') sfnt = (await unpackWoff2(job.bytes, engine.woff2Decompress)).sfnt;
  else sfnt = job.bytes;
  const source = container.kind === 'woff' || container.kind === 'woff2' ? container.kind : 'sfnt';
  return convertSfnt({ sfnt, source, target: job.target, fileName: job.fileName }, engine);
}
