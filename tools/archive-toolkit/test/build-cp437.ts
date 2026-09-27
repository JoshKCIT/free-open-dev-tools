/**
 * Test-side generator for `src/cp437.ts`: builds the 256-entry code page 437
 * to Unicode table from the vendored
 * `test/fixtures/cp437/CP437.TXT` (Unicode.org's own mapping file), parsing
 * its `0xXX<TAB>0xYYYY<TAB>#NAME` lines. A required test asserts the
 * committed module is exactly what a fresh build from the vendored file
 * produces.
 *
 * Only writes `src/cp437.ts` back to disk when `process.env.FODT_REGENERATE
 * === '1'`; every other run is read-only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SOURCE_PATH = join(ROOT, 'test', 'fixtures', 'cp437', 'CP437.TXT');
const OUTPUT_PATH = join(ROOT, 'src', 'cp437.ts');

const LINE_PATTERN = /^0x([0-9a-fA-F]{2})\t0x([0-9a-fA-F]{4,6})\t#/;

/**
 * Parses Unicode.org's own `CP437.TXT` mapping file text into a 256-entry
 * array indexed by byte value, each holding that byte's Unicode code point.
 * Throws if any of the 256 byte values 0x00-0xFF is not covered exactly
 * once -- a generator that silently produced a shorter table would be a
 * worse failure than one that refuses to run at all.
 */
export function parseCp437Table(text: string): number[] {
  const table = new Array<number | undefined>(256).fill(undefined);
  for (const line of text.split(/\r\n|\n/)) {
    const match = LINE_PATTERN.exec(line);
    if (!match) continue;
    const byte = parseInt(match[1]!, 16);
    const codePoint = parseInt(match[2]!, 16);
    if (table[byte] !== undefined) {
      throw new Error(`CP437.TXT defines byte 0x${match[1]} more than once`);
    }
    table[byte] = codePoint;
  }
  const missing: number[] = [];
  for (let i = 0; i < 256; i++) {
    if (table[i] === undefined) missing.push(i);
  }
  if (missing.length > 0) {
    throw new Error(`CP437.TXT is missing byte value(s): ${missing.map((b) => `0x${b.toString(16)}`).join(', ')}`);
  }
  return table as number[];
}

/** Renders `src/cp437.ts`'s exact source text from a built table. */
export function renderCp437Module(table: number[]): string {
  return [
    '/**',
    ' * Code page 437 to Unicode, generated from the vendored',
    " * test/fixtures/cp437/CP437.TXT (Unicode.org's own mapping file) --",
    ' * every ZIP entry name byte whose bit 11 UTF-8 flag (APPNOTE.TXT section',
    ' * 4.4.4) is unset is decoded through this table when it is not valid',
    ' * strict UTF-8. See test/build-cp437.ts for the generator this module',
    ' * must equal, and cp437-NOTICE.txt for the full licence notice.',
    ' */',
    '',
    `export const CP437_TABLE: readonly number[] = ${JSON.stringify(table)} as const;`,
    '',
    '/** Decodes bytes assumed to be code page 437 into a JavaScript string, one code point per byte. */',
    'export function decodeCp437(bytes: Uint8Array): string {',
    "  let out = '';",
    '  for (let i = 0; i < bytes.length; i++) {',
    '    out += String.fromCodePoint(CP437_TABLE[bytes[i]!]!);',
    '  }',
    '  return out;',
    '}',
    '',
  ].join('\n');
}

if (process.env.FODT_REGENERATE === '1') {
  const text = readFileSync(SOURCE_PATH, 'utf8');
  const table = parseCp437Table(text);
  writeFileSync(OUTPUT_PATH, renderCp437Module(table));
}
