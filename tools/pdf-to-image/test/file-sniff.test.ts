import { it, expect } from 'vitest';
import { getDocument } from '../src/index';
import { sniffFile, assertFileKind, FileSignatureError } from '../src/file-sniff';
import { buildMinimalPdf } from './minimal-pdf';
import { createTestBinaryDataFactory, createTestCanvasFactory } from './pdfjs-node';

/**
 * ISO 32000-1:2008 section 7.5.2 "File Header" (quoted in src/file-sniff.ts's
 * own header): the first line of a PDF file is `%PDF-1.N`. PDF.js's own
 * leniency (src/core/document.js, `find(stream, PDF_HEADER_SIGNATURE)`,
 * mozilla/pdf.js tag v6.3.289, default search limit 1024 bytes) is what this
 * tool's own 1024-byte search window matches.
 *
 * Top-level `it(...)` calls, never nested in `describe(...)`: Vitest's JSON
 * reporter concatenates the describe name into `fullName`, and this
 * project's own verify scripts match required titles by exact equality.
 */
it('a PDF header within the first 1024 bytes is recognised as ISO 32000 and PDF.js accept it', async () => {
  const junk = new Uint8Array(300).fill(0x20); // 300 bytes of junk before the header, still inside the window
  const pdf = buildMinimalPdf({ pages: [{ text: 'Hello' }] });
  const withJunk = new Uint8Array(junk.length + pdf.length);
  withJunk.set(junk, 0);
  withJunk.set(pdf, junk.length);

  expect(sniffFile(pdf)?.kind).toBe('pdf');
  expect(sniffFile(withJunk)?.kind).toBe('pdf');

  // PDF.js itself must also accept both: header at byte 0, and header
  // starting after 300 bytes of junk (still well within its own 1024-byte
  // search window).
  for (const bytes of [pdf, withJunk]) {
    // PDF.js's own `data` option detaches the buffer it is given once
    // loading starts; `.slice()` keeps `pdf` itself usable afterwards.
    const task = getDocument({
      data: bytes.slice(),
      useWorkerFetch: false,
      BinaryDataFactory: createTestBinaryDataFactory(),
      CanvasFactory: createTestCanvasFactory(),
      verbosity: 0,
    });
    const doc = await task.promise;
    expect(doc.numPages).toBe(1);
    await task.destroy();
  }

  // Beyond the 1024-byte search window, neither this tool nor PDF.js finds it.
  const tooFarJunk = new Uint8Array(1200).fill(0x20);
  const tooFar = new Uint8Array(tooFarJunk.length + pdf.length);
  tooFar.set(tooFarJunk, 0);
  tooFar.set(pdf, tooFarJunk.length);
  expect(sniffFile(tooFar)).toBeNull();
});

it('a file that is not a PDF is refused before it is parsed', () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const text = new TextEncoder().encode('just some plain text, definitely not a PDF');
  const empty = new Uint8Array(0);

  for (const bytes of [svg, text, empty]) {
    expect(sniffFile(bytes)).toBeNull();
  }
  expect(() => assertFileKind(svg, ['pdf'], { maxBytes: 1024 })).toThrow(FileSignatureError);
  expect(() => assertFileKind(text, ['pdf'], { maxBytes: 1024 })).toThrow(FileSignatureError);
  expect(() => assertFileKind(empty, ['pdf'], { maxBytes: 1024 })).toThrow(FileSignatureError);
});
