import { ByteReader } from './bytes';
import { FontInspectorError } from './errors';
import { compareGlyphs } from './glyph-data';
import { MAX_FILE_BYTES } from './limits';
import { readSfntFont, type SfntFont } from './sfnt';
import { visible } from './visible';
import { checkWoff1Output, unwrapWoff1 } from './woff1';
import { checkWoff2Output, unpackWoff2 } from './woff2';

/**
 * The re-read check of a conversion. Every converted file is read back before it is offered, and it is offered only
 * when this check finds no problem. The steps, in order:
 *
 * 1. the output's own container is parsed again (the WOFF or WOFF2 header and directory under every cap; a WOFF2 file that
 *    would expand more than 100 times when read, which readers refuse, is a problem here, with its own sentence);
 * 2. it is decoded back to an sfnt by a different code path from the one that wrote it (WOFF with the streaming inflater,
 *    WOFF2 with the engine's decoder, whose size the header states and which must equal the bytes that came out);
 * 3. the table tags equal the input's, and every table is byte for byte identical except head, glyf and loca after a WOFF2
 *    conversion (head may differ only in its four checksum adjustment bytes and flag bit 11, the one the format sets);
 * 4. glyf and loca are compared glyph by glyph, by value, as exact integers with no tolerance (flags, contour ends,
 *    coordinates, instructions, components);
 * 5. an sfnt output's table checksums and its whole-file checksum are checked.
 *
 * A file that fails any step is reported with the plain reason and `ok` false. The report never repeats the font's text.
 */

export interface VerifyEngine {
  woff2Decompress(input: Uint8Array): Promise<Uint8Array>;
}

export interface ConversionReport {
  /** True only when no step found a problem: the converted file may be offered. */
  ok: boolean;
  /** What the converted file is: 'sfnt', 'woff' or 'woff2'; null when it could not be recognised. */
  container: 'sfnt' | 'woff' | 'woff2' | null;
  /** How many tables the font has. */
  tablesTotal: number;
  /** How many of them are byte for byte identical after the conversion. */
  tablesIdentical: number;
  /** How many glyphs were compared (all of them when nothing is wrong). */
  glyphsCompared: number;
  /** What differs on purpose, as the format works, in plain words (empty when nothing differs). */
  byDesign: string[];
  /** Why the file must not be offered (empty when ok). */
  problems: string[];
}

const SIG_WOFF = 0x774f4646;
const SIG_WOFF2 = 0x774f4632;
const SFNT_SIGNATURES = new Set([0x00010000, 0x74727565, 0x4f54544f]);

const REWRITTEN = new Set(['head', 'glyf', 'loca']);

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function u16At(table: Uint8Array | undefined, offset: number): number | null {
  if (!table || table.length < offset + 2) return null;
  return (table[offset]! << 8) | table[offset + 1]!;
}

function tableOf(sfnt: Uint8Array, font: SfntFont, tag: string): Uint8Array | undefined {
  const entry = font.tables.get(tag);
  if (!entry || !entry.inFile) return undefined;
  return sfnt.subarray(entry.offset, entry.offset + entry.length);
}

/** Reads the output back and checks it against the input sfnt. Never throws for a bad output: that is a problem in the report. */
export async function verifyConversion(
  inputSfnt: Uint8Array,
  output: Uint8Array,
  engine: VerifyEngine,
): Promise<ConversionReport> {
  const report: ConversionReport = {
    ok: false,
    container: null,
    tablesTotal: 0,
    tablesIdentical: 0,
    glyphsCompared: 0,
    byDesign: [],
    problems: [],
  };
  const fail = (text: string): ConversionReport => {
    report.problems.push(text);
    report.ok = false;
    return report;
  };
  try {
    // Step 1: the output's own container, parsed again; step 2: decoded back to an sfnt by a different path.
    if (output.length < 12) return fail('The converted file is too short to be a font.');
    const signature = new ByteReader(output).u32(0);
    let decoded: Uint8Array;
    if (signature === SIG_WOFF) {
      report.container = 'woff';
      if (output.length > MAX_FILE_BYTES) {
        return fail('The converted WOFF file is larger than the 20 MiB this page checks, so it was not offered.');
      }
      const checked = checkWoff1Output(output);
      if (checked.problems.length > 0) {
        report.problems.push(...checked.problems);
        return report;
      }
      decoded = unwrapWoff1(output);
    } else if (signature === SIG_WOFF2) {
      report.container = 'woff2';
      if (output.length > MAX_FILE_BYTES) {
        return fail('The converted WOFF2 file is larger than the 20 MiB this page checks, so it was not offered.');
      }
      const checked = checkWoff2Output(output);
      if (checked.problems.length > 0 || !checked.header) {
        report.problems.push(...checked.problems);
        return report;
      }
      decoded = (await unpackWoff2(output, engine.woff2Decompress)).sfnt;
      // The size the header states is the size the file unpacks to, for a file this engine wrote; a header that lies is a fault.
      if (checked.header.totalSfntSize !== decoded.length) {
        return fail('The size stated in the header of the converted WOFF2 file is not the size it unpacks to.');
      }
    } else if (SFNT_SIGNATURES.has(signature)) {
      report.container = 'sfnt';
      decoded = output;
    } else {
      return fail('The converted file does not start as a TrueType, OpenType, WOFF or WOFF2 font does.');
    }
    const kind = report.container;

    // Step 3: the table directory and every table.
    const before = readSfntFont(inputSfnt, 0, false);
    const after = readSfntFont(decoded, 0, false);
    report.tablesTotal = before.order.length;
    if (kind === 'woff2' || kind === 'sfnt') {
      // The unpacked font is exactly its directory and its padded tables. A header that states a larger size makes the
      // decoder hand back zeros after the last table; one that states a smaller size cannot be unpacked at all. A TrueType
      // or OpenType output is held to the same end, so no step before this one can leave bytes after the last table.
      let end = 12 + 16 * after.order.length;
      for (const tag of after.order) {
        const entry = after.tables.get(tag)!;
        end = Math.max(end, entry.offset + Math.ceil(entry.length / 4) * 4);
      }
      if (kind === 'woff2' && decoded.length !== end) {
        report.problems.push('The converted WOFF2 file unpacks to more bytes than its tables hold.');
      }
      if (kind === 'sfnt' && decoded.length > end) {
        report.problems.push('The converted font file has more bytes than its tables hold.');
      }
    }
    const sortedBefore = [...before.order].sort();
    const sortedAfter = [...after.order].sort();
    if (sortedBefore.length !== sortedAfter.length || sortedBefore.some((tag, i) => tag !== sortedAfter[i])) {
      return fail(
        `The converted font has ${sortedAfter.length} tables and the font you opened has ${sortedBefore.length}, or their tags differ.`,
      );
    }
    for (const tag of before.order) {
      const a = tableOf(inputSfnt, before, tag);
      const b = tableOf(decoded, after, tag);
      if (!a || !b) return fail(`Table ${visible(tag, 8)} lies outside the file.`);
      if (sameBytes(a, b)) {
        report.tablesIdentical++;
        continue;
      }
      if (!REWRITTEN.has(tag)) {
        report.problems.push(`Table ${visible(tag, 8)} is not byte for byte the same in the converted font.`);
        continue;
      }
      if (tag === 'head') {
        // head may differ in the four checksum adjustment bytes (bytes 8 to 11) and, after a WOFF2 conversion, in flag bit 11
        // (bit 3 of the high byte of the flags, byte 16). Anything else is a fault.
        const adjustmentMayChange = kind !== 'woff';
        const flagMayChange = kind === 'woff2';
        let adjustmentChanged = false;
        let flagChanged = false;
        let other = a.length !== b.length;
        if (!other) {
          for (let i = 0; i < a.length; i++) {
            const x = a[i]!;
            const y = b[i]!;
            if (x === y) continue;
            if (i >= 8 && i < 12 && adjustmentMayChange) adjustmentChanged = true;
            else if (i === 16 && flagMayChange && (x ^ y) === 0x08) flagChanged = true;
            else other = true;
          }
        }
        if (other) {
          report.problems.push('Table head differs in more than its checksum adjustment and flag bit 11.');
        } else {
          const parts: string[] = [];
          if (adjustmentChanged) parts.push('the checksum adjustment is worked out again for the new file');
          if (flagChanged)
            parts.push('flag bit 11 (lossless modifying transform applied) is set, as the format requires');
          if (parts.length > 0) report.byDesign.push(`head: ${parts.join(', and ')}.`);
        }
        continue;
      }
      // glyf and loca: only a WOFF2 conversion lays them out again; for any other output they must be identical.
      if (kind !== 'woff2') {
        report.problems.push(`Table ${tag} is not byte for byte the same in the converted font.`);
      }
    }

    // Step 4: the glyphs, one by one, as values.
    const glyf0 = tableOf(inputSfnt, before, 'glyf');
    const loca0 = tableOf(inputSfnt, before, 'loca');
    const glyf1 = tableOf(decoded, after, 'glyf');
    const loca1 = tableOf(decoded, after, 'loca');
    const maxp0 = tableOf(inputSfnt, before, 'maxp');
    const maxp1 = tableOf(decoded, after, 'maxp');
    const numGlyphs = u16At(maxp0, 4);
    if (u16At(maxp1, 4) !== numGlyphs) report.problems.push('The glyph count is not the same in the converted font.');
    if (glyf0 || loca0) {
      if (!glyf0 || !loca0 || !glyf1 || !loca1) {
        report.problems.push('The converted font does not have the same glyph tables as the font you opened.');
      } else if (numGlyphs === null) {
        report.problems.push('The font has no usable maxp table, so its glyphs cannot be counted and compared.');
      } else {
        const format0 = u16At(tableOf(inputSfnt, before, 'head'), 50);
        const format1 = u16At(tableOf(decoded, after, 'head'), 50);
        if ((format0 !== 0 && format0 !== 1) || (format1 !== 0 && format1 !== 1)) {
          report.problems.push('The loca table of the font states a format the specification does not define.');
        } else {
          const result = compareGlyphs(
            { glyf: glyf0, loca: loca0, long: format0 === 1 },
            { glyf: glyf1, loca: loca1, long: format1 === 1 },
            numGlyphs,
          );
          report.glyphsCompared = result.compared;
          if (result.problem !== null) report.problems.push(result.problem);
          if (kind === 'woff2') {
            const glyfChanged = !sameBytes(glyf0, glyf1);
            const locaChanged = !sameBytes(loca0, loca1);
            if (glyfChanged) {
              report.byDesign.push(
                `glyf: WOFF2 stores the glyph data in its own layout and writes it out again, so the bytes differ; all ${result.compared} glyphs were compared by value${result.problem === null ? ' and are equal' : ''}.`,
              );
            }
            if (locaChanged) report.byDesign.push('loca: the glyph offsets follow the new glyph layout.');
          }
        }
      }
    } else if (numGlyphs !== null && (before.tables.has('CFF ') || before.tables.has('CFF2'))) {
      // The PostScript outlines are one table that is never rewritten, so its identity above covers every glyph.
      report.glyphsCompared = numGlyphs;
    }

    // Step 5: checksums of an sfnt output (and a table that was right going in must still be right coming out).
    for (const tag of before.order) {
      const a = before.tables.get(tag)!;
      const b = after.tables.get(tag)!;
      if (b.checksumOk === false && a.checksumOk !== false) {
        report.problems.push(`The checksum of table ${visible(tag, 8)} is wrong in the converted font.`);
      }
    }
    if (kind === 'sfnt' && after.tables.has('head') && after.wholeFileOk === false) {
      report.problems.push('The whole-file checksum of the converted font does not match its head table.');
    }
    report.ok = report.problems.length === 0;
    return report;
  } catch (err) {
    if (err instanceof FontInspectorError) return fail(`The converted file could not be read back: ${err.message}`);
    return fail('The converted file could not be read back.');
  }
}
