/**
 * Builders for real files this project's browser suite attaches to a file
 * input, each carrying a caller-supplied marker string somewhere a real
 * viewer of that format would actually read it (a PDF's own text content
 * and document title; later kinds add image metadata and archive entry
 * content). Every builder here is written from the same specifications
 * this repository's tool packages already cite, never imported from a
 * tool package: e2e code does not import tool test code, so a PDF here is
 * built again from ISO 32000-1's own object/xref/trailer grammar rather
 * than reusing `tools/pdf-to-image/test/minimal-pdf.ts`.
 *
 * A later plan in this phase adds every other kind (PNG, JPEG, GIF, WebP,
 * BMP, ZIP, TAR, tar.gz, gzip, plain text) and the low-level writers those
 * kinds need; this plan's own scope is only what its own tracer proves:
 * `pdf` and `pdf-3`.
 */

export type FixtureFileKind = 'pdf' | 'pdf-3';

export const FIXTURE_FILE_KINDS: FixtureFileKind[] = ['pdf', 'pdf-3'];

export interface FixtureFile {
  name: string;
  mimeType: string;
  buffer: Uint8Array;
}

/**
 * ISO 3309's cyclic redundancy check, the same CRC-32 the PNG and ZIP
 * specifications both use (reflected, IEEE 802.3 polynomial 0xEDB88320).
 * A later plan's PNG and ZIP writers both need this; it lives here rather
 * than per-writer since both consume the exact same table and algorithm.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapePdfString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export interface PdfPageSpec {
  /** Text drawn in Times-Roman, near the top of a US Letter page. */
  text?: string;
}

/**
 * A small, valid, multi-page PDF built directly from ISO 32000-1:2008
 * sections 7.3 "Objects", 7.5.2 "File Header", 7.5.4 "Cross-Reference
 * Table" and 7.5.5 "File Trailer": one Catalog, one Pages tree, one Page
 * object and one content stream per entry in `pages`, one shared
 * Times-Roman font resource, and a Document Information dictionary
 * carrying `marker` as its Title. Every cross-reference entry is exactly
 * 20 bytes, offsets measured as each object is appended, matching the
 * specification's own fixed entry format.
 */
export function writePdf(pages: PdfPageSpec[], marker: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [0];

  const push = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    chunks.push(bytes);
    length += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const beginObject = (num: number) => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
  };
  const endObject = () => push('endobj\n');

  push('%PDF-1.7\n');
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const catalogNum = 1;
  const pagesNum = 2;
  const infoNum = 3;
  const fontNum = 4;
  let nextObjNum = 5;
  const pageNums: number[] = [];
  const contentNums: number[] = [];
  for (const _p of pages) {
    pageNums.push(nextObjNum++);
    contentNums.push(nextObjNum++);
  }

  beginObject(catalogNum);
  push(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>\n`);
  endObject();

  beginObject(pagesNum);
  push(`<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>\n`);
  endObject();

  beginObject(infoNum);
  push(`<< /Title (${escapePdfString(marker)}) >>\n`);
  endObject();

  beginObject(fontNum);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>\n');
  endObject();

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const pageNum = pageNums[i]!;
    const contentNum = contentNums[i]!;
    const lineOne = page.text ?? '';
    const content = `BT /F1 18 Tf 72 700 Td (${escapePdfString(lineOne)}) Tj ET\nBT /F1 12 Tf 72 60 Td (${escapePdfString(marker)}) Tj ET\n`;

    beginObject(pageNum);
    push(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNum} 0 R >>\n`,
    );
    endObject();

    const contentBytes = new TextEncoder().encode(content);
    beginObject(contentNum);
    push(`<< /Length ${contentBytes.length} >>\nstream\n`);
    pushBytes(contentBytes);
    push('\nendstream\n');
    endObject();
  }

  const size = nextObjNum;
  const xrefOffset = length;
  push(`xref\n0 ${size}\n`);
  push('0000000000 65535 f\r\n');
  for (let i = 1; i < size; i++) {
    push(`${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n\r\n`);
  }
  push('trailer\n');
  push(`<< /Size ${size} /Root ${catalogNum} 0 R /Info ${infoNum} 0 R >>\n`);
  push(`startxref\n${xrefOffset}\n%%EOF`);

  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Builds one fixture file of the given kind, carrying `marker`.
 * `index` (1-based) only affects the file's own name, for a scenario that
 * attaches more than one file of the same kind.
 */
export function buildFixtureFile(kind: FixtureFileKind, marker: string, index?: number): FixtureFile {
  const suffix = index && index > 1 ? `-${index}` : '';
  switch (kind) {
    case 'pdf':
      return {
        name: `sample${suffix}.pdf`,
        mimeType: 'application/pdf',
        buffer: writePdf([{ text: 'Page 1' }], marker),
      };
    case 'pdf-3':
      return {
        name: `sample${suffix}.pdf`,
        mimeType: 'application/pdf',
        buffer: writePdf([{ text: 'Page 1' }, { text: 'Page 2' }, { text: 'Page 3' }], marker),
      };
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown fixture file kind: ${String(exhaustive)}`);
    }
  }
}

/** Splits a comma-separated list of kinds and builds one file per kind, in order. */
export function buildFixtureFiles(commaSeparatedKinds: string, marker: string): FixtureFile[] {
  const kinds = commaSeparatedKinds
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  const counts = new Map<string, number>();
  return kinds.map((kind) => {
    if (!FIXTURE_FILE_KINDS.includes(kind as FixtureFileKind)) {
      throw new Error(`Unknown fixture file kind: "${kind}"`);
    }
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    return buildFixtureFile(kind as FixtureFileKind, marker, n);
  });
}
