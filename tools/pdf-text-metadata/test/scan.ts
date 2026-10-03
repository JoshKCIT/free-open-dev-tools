/**
 * Test-only helpers for looking inside the bytes of a PDF: the file as written, and every stream after it is decoded,
 * so a marker string hidden in a compressed object is still found. The expected values in the tests come from the strings
 * given to the fixture writers, never from these helpers.
 */
import { PDFDocument, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';

/** The bytes of a fixture given as base64 text. */
export function fixtureBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/** How many times `needle` (ASCII) occurs in the bytes as written. */
export function countIn(bytes: Uint8Array, needle: string): number {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const target = Buffer.from(needle, 'latin1');
  let count = 0;
  let from = 0;
  for (;;) {
    const at = buffer.indexOf(target, from);
    if (at < 0) return count;
    count++;
    from = at + target.length;
  }
}

/**
 * Every stream of the file after decoding (Flate and the other filters pdf-lib can undo), joined as one string, so a
 * search covers the content of compressed objects too. A stream that cannot be decoded is searched as it is written.
 */
export async function decodedStreams(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const parts: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    let content: Uint8Array;
    try {
      content = decodePDFRawStream(object).decode();
    } catch {
      content = object.getContents();
    }
    parts.push(Buffer.from(content).toString('latin1'));
  }
  return parts.join('\n');
}

/** How many times `needle` occurs in the bytes as written plus in every decoded stream. */
export async function countEverywhere(bytes: Uint8Array, needle: string): Promise<number> {
  const decoded = await decodedStreams(bytes);
  let count = countIn(bytes, needle);
  let from = 0;
  for (;;) {
    const at = decoded.indexOf(needle, from);
    if (at < 0) return count;
    count++;
    from = at + needle.length;
  }
}
