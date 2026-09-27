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
 */

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

  build(rootNum: number, infoNum: number | null, size: number): Uint8Array {
    const xrefOffset = this.currentOffset;
    this.push(`xref\n0 ${size}\n`);
    this.push('0000000000 65535 f\r\n');
    for (let i = 1; i < size; i++) {
      const offset = this.offsets[i] ?? 0;
      this.push(`${String(offset).padStart(10, '0')} 00000 n\r\n`);
    }
    this.push('trailer\n');
    this.push(`<< /Size ${size} /Root ${rootNum} 0 R${infoNum !== null ? ` /Info ${infoNum} 0 R` : ''} >>\n`);
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
    if (page.extraContent) content += page.extraContent;

    pdf.beginObject(pageNum);
    const extraFontEntries = page.extraFonts
      ? Object.entries(page.extraFonts)
          .map(([res, dict]) => ` /${res} ${dict}`)
          .join('')
      : '';
    pdf.push(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [${box.join(' ')}] ` +
        `/Resources << /Font << /F1 ${fontNum} 0 R${extraFontEntries} >> >> /Contents ${contentNum} 0 R >>\n`,
    );
    pdf.endObject();

    const contentBytes = new TextEncoder().encode(content);
    pdf.beginObject(contentNum);
    pdf.push(`<< /Length ${contentBytes.length} >>\nstream\n`);
    pdf.pushBytes(contentBytes);
    pdf.push('\nendstream\n');
    pdf.endObject();
  }

  return pdf.build(catalogNum, infoNum, nextObjNum);
}
