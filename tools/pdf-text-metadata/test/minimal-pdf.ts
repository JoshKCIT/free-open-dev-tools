/**
 * A hand-written, test-only PDF writer, built directly from ISO 32000-1:2008
 * sections 7.3 "Objects" (through 7.3.7's stream objects), 7.5.2 "File
 * Header", 7.5.4 "Cross-Reference Table" and 7.5.5 "File Trailer" (fetched
 * from Adobe's own public copy, session of the tracer plan for this phase).
 * No library builds this file's fixtures: PDF.js is the thing under test,
 * so its own PDF-writing code (or any other tool's) must never be the
 * oracle that proves it correct.
 *
 * Every cross-reference entry is exactly 20 bytes -- "nnnnnnnnnn ggggg n"
 * (10 + 1 + 5 + 1 + 1 = 18 bytes) followed by the 2-byte end-of-line
 * sequence \r\n, per 7.5.4's own entry format -- and every byte offset in
 * the table is the real, measured offset of that object's first byte in
 * the finished file, tracked as each object is appended.
 *
 * `userPassword` builds the Standard Security Handler's own Algorithm 3.2
 * (compute an encryption key), 3.3 (compute the O value) and 3.4 (compute
 * the U value, revision 2) exactly as ISO 32000-1's own Annex C describes
 * them (RC4, 40-bit, revision 2 -- the simplest variant, sufficient to
 * prove PDF.js's own password check runs the real algorithm against a real
 * password-protected file). Node's own `node:crypto` MD5 is used here
 * (test-only code, never shipped): the package this file tests never
 * touches Node's crypto module itself.
 */
import { createHash } from 'node:crypto';

/** ISO 32000-1:2008 Annex C, Algorithm 3.2's own fixed 32-byte padding string. */
const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00,
  0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function padPassword(password: string): Uint8Array {
  const bytes = new TextEncoder().encode(password).slice(0, 32);
  const out = new Uint8Array(32);
  out.set(bytes, 0);
  out.set(PAD.slice(0, 32 - bytes.length), bytes.length);
  return out;
}

function md5(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash('md5');
  for (const p of parts) hash.update(p);
  return new Uint8Array(hash.digest());
}

/** A textbook RC4 stream cipher (test-only; never shipped in the package under test). */
function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

function int32LE(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setInt32(0, n, true);
  return buf;
}

/** Standard Security Handler, revision 2 (RC4, 40-bit key): returns the /O, /U values and the file encryption key. */
function computeStandardSecurity(
  userPassword: string,
  fileId: Uint8Array,
): { o: Uint8Array; u: Uint8Array; p: number } {
  const ownerKey = md5(padPassword('')).slice(0, 5); // no distinct owner password: use the padded empty string
  const o = rc4(ownerKey, padPassword(userPassword));
  const p = -44; // a valid 32-bit permission value (reserved bits set per Table 22); the exact permissions do not matter for this fixture's purpose
  const fileKey = md5(padPassword(userPassword), o, int32LE(p), fileId).slice(0, 5);
  const u = rc4(fileKey, PAD);
  return { o, u, p };
}

const STANDARD_FONTS = [
  'Times-Roman',
  'Helvetica',
  'Courier',
  'Symbol',
  'Times-Bold',
  'Helvetica-Bold',
  'Courier-Bold',
  'ZapfDingbats',
  'Times-Italic',
  'Helvetica-Oblique',
  'Courier-Oblique',
  'Times-BoldItalic',
  'Helvetica-BoldOblique',
  'Courier-BoldOblique',
] as const;

export type StandardFontName = (typeof STANDARD_FONTS)[number];
export { STANDARD_FONTS };

export interface MinimalPdfPage {
  /** Text drawn at a fixed position in the named standard font. */
  text?: string;
  font?: StandardFontName;
  /** MediaBox, in default user space units (1/72 inch, ISO 32000-1 8.3.2.3). Default US Letter. */
  mediaBox?: [number, number, number, number];
  /** 0-1 RGB fill used for a rectangle drawn in the lower-left of the page. */
  fillColor?: [number, number, number];
  /** Raw content-stream operators appended after the rectangle and text, for a page needing more control. */
  extraContent?: string;
  /** Extra font dictionary entries this page's /Resources should declare, keyed by resource name. */
  extraFonts?: Record<string, string>;
  /**
   * When true, this page also declares a Type0/CIDFontType0 font (resource
   * `/F2`) whose `/Encoding` names `UniJIS-UCS2-H` (ISO 32000-1 9.7,
   * "Composite Fonts") and whose descendant is not embedded, and draws one
   * two-byte character with it -- the shape that makes PDF.js ask for a
   * built-in CMap this tool never bundles.
   */
  cjkText?: boolean;
}

export interface MinimalPdfOptions {
  pages: MinimalPdfPage[];
  /** Document Information Dictionary Title -- used by e2e fixtures to carry a marker. */
  title?: string;
  /** When set, the file is written with the RC4 standard security handler requiring this user password. */
  userPassword?: string;
  /** When set, a JavaScript document-level action is added (OpenAction), naming the given script text. */
  openActionJavaScript?: string;
}

function escapePdfString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** ISO 32000-1:2008 7.3.4.3 "Hexadecimal Strings": `<...>`, for raw (non-text) byte strings like /O, /U and /ID. */
function toHexString(bytes: Uint8Array): string {
  return `<${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}>`;
}

class PdfBuilder {
  private chunks: Uint8Array[] = [];
  private length = 0;
  private offsets: number[] = [0]; // object 0 is the free head, offset unused

  push(text: string): void {
    const bytes = new TextEncoder().encode(text);
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  pushBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  get currentOffset(): number {
    return this.length;
  }

  /** Starts indirect object `num`, recording its byte offset for the xref table. */
  beginObject(num: number): void {
    this.offsets[num] = this.currentOffset;
    this.push(`${num} 0 obj\n`);
  }

  endObject(): void {
    this.push('endobj\n');
  }

  build(
    rootNum: number,
    infoNum: number | null,
    size: number,
    encrypt?: { encryptNum: number; fileId: Uint8Array },
  ): Uint8Array {
    const xrefOffset = this.currentOffset;
    this.push(`xref\n0 ${size}\n`);
    this.push('0000000000 65535 f\r\n');
    for (let i = 1; i < size; i++) {
      const offset = this.offsets[i] ?? 0;
      this.push(`${String(offset).padStart(10, '0')} 00000 n\r\n`);
    }
    this.push('trailer\n');
    const idEntry = encrypt ? ` /ID [${toHexString(encrypt.fileId)} ${toHexString(encrypt.fileId)}]` : '';
    const encryptEntry = encrypt ? ` /Encrypt ${encrypt.encryptNum} 0 R` : '';
    this.push(
      `<< /Size ${size} /Root ${rootNum} 0 R${infoNum !== null ? ` /Info ${infoNum} 0 R` : ''}${encryptEntry}${idEntry} >>\n`,
    );
    this.push(`startxref\n${xrefOffset}\n%%EOF`);

    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * Builds a small, valid, multi-page PDF: a Catalog, a Pages tree, one Page
 * object per entry in `options.pages`, one Type1 standard-font resource per
 * distinct font named, and one content stream per page drawing a filled
 * rectangle (when `fillColor` is given) and a line of text in the page's
 * own named standard font (default Times-Roman).
 */
export function buildMinimalPdf(options: MinimalPdfOptions): Uint8Array {
  const pdf = new PdfBuilder();
  pdf.push('%PDF-1.7\n');
  // A comment line with four bytes over 0x7f, as 7.5.2's own "binary file" note recommends
  // for a file whose later bytes may include non-ASCII data.
  pdf.pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  let nextObjNum = 1;
  const catalogNum = nextObjNum++;
  const pagesNum = nextObjNum++;
  const infoNum = options.title !== undefined ? nextObjNum++ : null;

  // A CJK Type0 font (ISO 32000-1 9.7 "Composite Fonts"), only allocated
  // when a page asks for it: a non-embedded CIDFontType0 descendant naming
  // the built-in CMap UniJIS-UCS2-H, which this tool never bundles.
  const needsCjkFont = options.pages.some((p) => p.cjkText);
  let cjkType0Num: number | null = null;
  let cjkDescendantNum: number | null = null;
  let cjkDescriptorNum: number | null = null;
  if (needsCjkFont) {
    cjkType0Num = nextObjNum++;
    cjkDescendantNum = nextObjNum++;
    cjkDescriptorNum = nextObjNum++;
  }

  // One Type1 font object per distinct standard font name used across every page.
  const fontNames = new Set<StandardFontName>();
  for (const p of options.pages) fontNames.add(p.font ?? 'Times-Roman');
  const fontObjNums = new Map<StandardFontName, number>();
  for (const name of fontNames) fontObjNums.set(name, nextObjNum++);

  const pageNums: number[] = [];
  const contentNums: number[] = [];
  for (const _p of options.pages) {
    pageNums.push(nextObjNum++);
    contentNums.push(nextObjNum++);
  }

  const encryptNum = options.userPassword !== undefined ? nextObjNum++ : null;

  // Catalog
  pdf.beginObject(catalogNum);
  const openAction = options.openActionJavaScript
    ? ` /OpenAction << /Type /Action /S /JavaScript /JS (${escapePdfString(options.openActionJavaScript)}) >>`
    : '';
  pdf.push(`<< /Type /Catalog /Pages ${pagesNum} 0 R${openAction} >>\n`);
  pdf.endObject();

  // Pages tree
  pdf.beginObject(pagesNum);
  pdf.push(`<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>\n`);
  pdf.endObject();

  // Info dictionary, carrying the marker for e2e fixtures.
  if (infoNum !== null) {
    pdf.beginObject(infoNum);
    pdf.push(`<< /Title (${escapePdfString(options.title!)}) >>\n`);
    pdf.endObject();
  }

  // Font resources (one Type1 dictionary per standard font name in use).
  for (const [name, num] of fontObjNums) {
    pdf.beginObject(num);
    pdf.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} >>\n`);
    pdf.endObject();
  }

  // The CJK Type0 font, its non-embedded CIDFontType0 descendant and a
  // minimal FontDescriptor (ISO 32000-1 9.7 and 9.8.1's own required keys).
  if (needsCjkFont) {
    pdf.beginObject(cjkDescriptorNum!);
    pdf.push(
      '<< /Type /FontDescriptor /FontName /Ryumin-Light /Flags 4 /FontBBox [0 0 1000 1000] ' +
        '/ItalicAngle 0 /Ascent 1000 /Descent -200 /CapHeight 1000 /StemV 0 >>\n',
    );
    pdf.endObject();

    pdf.beginObject(cjkDescendantNum!);
    pdf.push(
      `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /Ryumin-Light ` +
        `/CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> ` +
        `/FontDescriptor ${cjkDescriptorNum} 0 R /DW 1000 >>\n`,
    );
    pdf.endObject();

    pdf.beginObject(cjkType0Num!);
    pdf.push(
      `<< /Type /Font /Subtype /Type0 /BaseFont /Ryumin-Light /Encoding /UniJIS-UCS2-H ` +
        `/DescendantFonts [${cjkDescendantNum} 0 R] >>\n`,
    );
    pdf.endObject();
  }

  // Pages and their content streams.
  for (let i = 0; i < options.pages.length; i++) {
    const page = options.pages[i]!;
    const pageNum = pageNums[i]!;
    const contentNum = contentNums[i]!;
    const box = page.mediaBox ?? [0, 0, 612, 792];
    const fontName = page.font ?? 'Times-Roman';
    const fontNum = fontObjNums.get(fontName)!;

    let content = '';
    if (page.fillColor) {
      const [r, g, b] = page.fillColor;
      content += `${r} ${g} ${b} rg\n50 50 200 100 re f\n`;
    }
    if (page.text) {
      content += `BT /F1 24 Tf 72 ${box[3] - 100} Td (${escapePdfString(page.text)}) Tj ET\n`;
    }
    if (page.cjkText) {
      // A two-byte CID code in a hex string: ISO 32000-1 9.4.3's own
      // hex-string text-showing form, used with a Type0 font (9.7.1).
      content += `BT /F2 24 Tf 72 100 Td <3042> Tj ET\n`;
    }
    if (page.extraContent) content += page.extraContent;

    pdf.beginObject(pageNum);
    const extraFontEntries = page.extraFonts
      ? Object.entries(page.extraFonts)
          .map(([res, dict]) => ` /${res} ${dict}`)
          .join('')
      : '';
    const cjkFontEntry = page.cjkText ? ` /F2 ${cjkType0Num} 0 R` : '';
    pdf.push(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [${box.join(' ')}] ` +
        `/Resources << /Font << /F1 ${fontNum} 0 R${cjkFontEntry}${extraFontEntries} >> >> /Contents ${contentNum} 0 R >>\n`,
    );
    pdf.endObject();

    const contentBytes = new TextEncoder().encode(content);
    pdf.beginObject(contentNum);
    pdf.push(`<< /Length ${contentBytes.length} >>\nstream\n`);
    pdf.pushBytes(contentBytes);
    pdf.push('\nendstream\n');
    pdf.endObject();
  }

  if (encryptNum !== null) {
    // A fixed, deterministic 16-byte file ID: real-world IDs are random,
    // but this fixture only needs a stable, reproducible one.
    const fileId = Uint8Array.from({ length: 16 }, (_, i) => (i * 7 + 11) & 0xff);
    const { o, u, p } = computeStandardSecurity(options.userPassword!, fileId);
    pdf.beginObject(encryptNum);
    pdf.push(`<< /Filter /Standard /V 1 /R 2 /O ${toHexString(o)} /U ${toHexString(u)} /P ${p} >>\n`);
    pdf.endObject();
    return pdf.build(catalogNum, infoNum, nextObjNum, { encryptNum, fileId });
  }

  return pdf.build(catalogNum, infoNum, nextObjNum);
}
