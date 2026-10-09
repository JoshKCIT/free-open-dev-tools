/**
 * Test-only builders for files that use a stream labelled as a picture as something a reader decodes: page content, a
 * font program, a character map or an object stream. They sit on the builders of `bombs.ts` (never edited) and write
 * the objects as ISO 32000-1:2008 describes them: section 7.3.8 (a stream is a dictionary, the keyword `stream`, the
 * data and `endstream`), section 7.5.7 (an object stream is a stream with `/Type /ObjStm`, `/N` objects and the byte
 * offset `/First` of the first one, after `/N` pairs of an object number and an offset) and section 7.8.2 (content
 * streams, referenced by the page's `/Contents`).
 */
import { deflateSync } from 'node:zlib';
import { buildRawPdf, streamObject, type RawObject } from './bombs';

/** The dictionary entries of an image XObject (ISO 32000-1:2008 section 8.9.5), without a filter entry. */
export const PICTURE_DICTIONARY =
  '/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray';

/**
 * A stream whose dictionary calls it a picture. `extraDict` is written after the picture entries, `data` is the stream
 * data as given (already encoded for `filter`), and `filter` is the filter entry's value (`/FlateDecode` by default,
 * `''` for no filter at all).
 */
export function pictureStream(extraDict: string, data: Uint8Array, filter = '/FlateDecode'): Buffer {
  const filterEntry = filter === '' ? '' : ` /Filter ${filter}`;
  return streamObject(`${PICTURE_DICTIONARY}${filterEntry} ${extraDict}`.trimEnd(), data);
}

/** An object held inside an object stream: its number and its text (what would sit between `obj` and `endobj`). */
export interface HeldObject {
  number: number;
  text: string;
}

/**
 * A Flate object stream (section 7.5.7) that holds `objects`: a header of `number offset` pairs, then the texts in order,
 * one space apart. Returned as an object of the file with the given object `number`.
 */
export function objectStreamWith(objects: HeldObject[], number: number, extraDict = ''): RawObject {
  let header = '';
  let body = '';
  for (const object of objects) {
    header += `${object.number} ${body.length} `;
    body += `${object.text} `;
  }
  const first = header.length;
  const data = deflateSync(Buffer.from(header + body, 'latin1'));
  const dictionary = `/Type /ObjStm /N ${objects.length} /First ${first} /Filter /FlateDecode ${extraDict}`.trimEnd();
  return { number, body: streamObject(dictionary, data) };
}

/**
 * A one page file whose page content is object 4, a picture-labelled stream, followed by `unused` more picture-labelled
 * streams (objects 10 and up) that nothing uses. It has no cross-reference table: the memory check reads streams by
 * their keywords, and the quadratic cost of `buildRawPdf` (it copies the whole file once per object) would swamp a test
 * of twenty thousand streams.
 */
export function pageWithManyPictures(unused: number, data: Uint8Array): Uint8Array {
  const parts: Buffer[] = [
    Buffer.from(
      '%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>\nendobj\n',
    ),
  ];
  const stream = pictureStream('', data);
  for (let i = -1; i < unused; i++) {
    parts.push(Buffer.from(`${i < 0 ? 4 : 10 + i} 0 obj\n`), stream, Buffer.from('\nendobj\n'));
  }
  return new Uint8Array(Buffer.concat(parts));
}

const CATALOG: RawObject = { number: 1, body: Buffer.from('<< /Type /Catalog /Pages 2 0 R >>') };
const PAGES: RawObject = { number: 2, body: Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>') };

/**
 * A one page file whose page dictionary (object 3) lives inside object stream 9, as files saved with object streams
 * have it. `pageEntries` are the page's own entries, `held` more objects inside the same object stream, and `plain` the
 * objects written outside it (numbers 4 and up, never 9).
 */
export function pageWithObjects(pageEntries: string, plain: RawObject[], held: HeldObject[] = []): Uint8Array {
  const page: HeldObject = {
    number: 3,
    text: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] ${pageEntries} >>`,
  };
  return buildRawPdf([CATALOG, PAGES, objectStreamWith([page, ...held], 9), ...plain]);
}
