/**
 * Test-only builders for hostile and unusual PDFs and for the encodings the expansion check reads. The platform's zlib
 * writes the Flate data here (it is the second opinion, never the code under test); the LZW, ASCII85, ASCII hex and
 * run-length writers are small encoders written from ISO 32000-1:2008 sections 7.4.2 to 7.4.5.
 */
import { createDeflate } from 'node:zlib';
import { once } from 'node:events';

/** Flate data (zlib format) for `mib` mebibytes of zeros after the optional `prefix`, written in pieces so it stays small. */
export async function deflateZeros(mib: number, prefix?: Uint8Array, level = 6): Promise<Buffer> {
  const deflate = createDeflate({ level });
  const parts: Buffer[] = [];
  deflate.on('data', (chunk: Buffer) => parts.push(chunk));
  const finished = once(deflate, 'end');
  if (prefix) deflate.write(prefix);
  const piece = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < mib; i++) {
    if (!deflate.write(piece)) await once(deflate, 'drain');
  }
  deflate.end();
  await finished;
  return Buffer.concat(parts);
}

export interface RawObject {
  number: number;
  /** The text between `N 0 obj` and `endobj`; for a stream, the dictionary, the keyword and the data. */
  body: Buffer;
}

/** A dictionary, a `stream` keyword, the data and `endstream` as the body of an object. */
export function streamObject(dictionary: string, data: Uint8Array, withLength = true): Buffer {
  const dict = withLength ? `<< ${dictionary} /Length ${data.length} >>` : `<< ${dictionary} >>`;
  return Buffer.concat([Buffer.from(`${dict}\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
}

/** A file with a correct cross-reference table for the given objects, whose catalog is object 1. */
export function buildRawPdf(objects: RawObject[]): Uint8Array {
  let out = Buffer.from('%PDF-1.5\n', 'latin1');
  const offsets = new Map<number, number>();
  for (const { number, body } of objects) {
    offsets.set(number, out.length);
    out = Buffer.concat([out, Buffer.from(`${number} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
  }
  const size = Math.max(...objects.map((o) => o.number)) + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) {
    const at = offsets.get(n);
    xref += at === undefined ? '0000000000 00000 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`;
  }
  const xrefAt = out.length;
  out = Buffer.concat([
    out,
    Buffer.from(`${xref}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1'),
  ]);
  return new Uint8Array(out);
}

const CATALOG: RawObject = { number: 1, body: Buffer.from('<< /Type /Catalog /Pages 2 0 R >>') };
const PAGES: RawObject = { number: 2, body: Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>') };

/** A one page file with the extra objects given (numbers 4 and up) and the page's own dictionary entries. */
export function pageWith(pageEntries: string, extra: RawObject[]): Uint8Array {
  const page: RawObject = {
    number: 3,
    body: Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] ${pageEntries} >>`),
  };
  return buildRawPdf([CATALOG, PAGES, page, ...extra]);
}

/** Reviewer's first probe: a file under one megabyte whose object stream inflates to `mib` mebibytes. */
export async function objectStreamBomb(mib: number): Promise<Uint8Array> {
  const flate = await deflateZeros(mib, Buffer.from('10 0 (x) '));
  return buildRawPdf([
    CATALOG,
    PAGES,
    { number: 3, body: Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>') },
    { number: 5, body: streamObject('/Type /ObjStm /N 1 /First 5 /Filter /FlateDecode', flate) },
  ]);
}

/** Reviewer's second probe: a page whose content stream inflates to `mib` mebibytes of spaces after a line of text. */
export async function contentStreamBomb(mib: number, filter = '/FlateDecode'): Promise<Uint8Array> {
  const flate = await deflateZeros(mib, Buffer.from('BT /F1 12 Tf 10 10 Td (hello) Tj ET\n'));
  return pageWith('/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>', [
    { number: 4, body: streamObject(`/Filter ${filter}`, flate) },
    { number: 5, body: Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>') },
  ]);
}

// --- Encoders -------------------------------------------------------------------------------------------------------

/** LZWDecode data (ISO 32000-1:2008 section 7.4.4.2): a clear code first, then the codes, then the end code. */
export function lzwEncode(data: Uint8Array, earlyChange = 1): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  let width = 9;
  const widthFor = (count: number) => {
    const reach = count + earlyChange;
    return reach >= 2048 ? 12 : reach >= 1024 ? 11 : reach >= 512 ? 10 : 9;
  };
  const emit = (code: number) => {
    buffer = (buffer << width) | code;
    bits += width;
    while (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  };
  let table = new Map<number, number>();
  let next = 258;
  // What a decoder's own table size is after the codes written so far: it lags this encoder's by one code.
  let decoderNext = 258;
  let first = true;
  const afterCode = () => {
    if (first) first = false;
    else if (decoderNext < 4096) decoderNext++;
    width = widthFor(decoderNext);
  };
  const clear = () => {
    emit(256);
    table = new Map();
    next = 258;
    decoderNext = 258;
    first = true;
    width = 9;
  };
  clear();
  let current = -1;
  for (const byte of data) {
    if (current < 0) {
      current = byte;
      continue;
    }
    const key = current * 256 + byte;
    const known = table.get(key);
    if (known !== undefined) {
      current = known;
      continue;
    }
    emit(current);
    afterCode();
    table.set(key, next++);
    if (next >= 4094) clear();
    current = byte;
  }
  if (current >= 0) {
    emit(current);
    afterCode();
  }
  emit(257);
  if (bits > 0) out.push((buffer << (8 - bits)) & 0xff);
  return Uint8Array.from(out);
}

/** ASCII85Decode data: groups of four bytes as five characters, a short last group, then the end marker. */
export function ascii85Encode(data: Uint8Array): Uint8Array {
  let text = '';
  for (let at = 0; at < data.length; at += 4) {
    const size = Math.min(4, data.length - at);
    let value = 0;
    for (let k = 0; k < 4; k++) value = value * 256 + (k < size ? data[at + k]! : 0);
    const group: number[] = [];
    for (let k = 0; k < 5; k++) {
      group.unshift(value % 85);
      value = Math.floor(value / 85);
    }
    if (size === 4 && group.every((g) => g === 0)) text += 'z';
    else
      text += group
        .slice(0, size + 1)
        .map((g) => String.fromCharCode(g + 33))
        .join('');
  }
  return Buffer.from(`${text}~>`, 'latin1');
}

/** ASCIIHexDecode data: two hexadecimal digits per byte and a closing `>`. */
export function asciiHexEncode(data: Uint8Array): Uint8Array {
  return Buffer.from(`${Buffer.from(data).toString('hex')}>`, 'latin1');
}

/** RunLengthDecode data: runs of four or more equal bytes as a repeat, everything else as literals, then 128. */
export function runLengthEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let at = 0;
  while (at < data.length) {
    let run = 1;
    while (at + run < data.length && data[at + run] === data[at] && run < 128) run++;
    if (run >= 3) {
      out.push(257 - run, data[at]!);
      at += run;
      continue;
    }
    const start = at;
    while (
      at < data.length &&
      at - start < 128 &&
      !(at + 2 < data.length && data[at] === data[at + 1] && data[at] === data[at + 2])
    )
      at++;
    if (at === start) at++;
    out.push(at - start - 1, ...data.subarray(start, at));
  }
  out.push(128);
  return Uint8Array.from(out);
}
