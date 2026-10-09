import { deflateSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { EXPANSION_MESSAGE, PdfToolError, checkExpansion } from '../src/index';
import { buildRawPdf, pageWith, streamObject, type RawObject } from './bombs';
import { openWithPdfJs } from './pdfjs-node';
import { PICTURE_DICTIONARY, pictureStream } from './picture-builders';

/**
 * How the memory check tells a picture from any other stream, and how it finds where a stream starts. A stream is left
 * out as a picture only when its own dictionary's `/Subtype` entries all say `/Image`, read the way a reader reads a
 * dictionary: ISO 32000-1:2008 section 7.3.7 (a dictionary is keys and values; a value may be a string, a nested
 * dictionary or an array), section 7.3.4 (a literal string holds balanced parentheses and backslash escapes; a hexadecimal
 * string ends at `>`), section 7.2.3 (a comment runs from `%` to the end of the line), section 7.3.5 (a name may write
 * any character as `#` and two hexadecimal digits), section 7.3.10 (an object is `number generation obj`, and a comment
 * may stand wherever white space may) and section 8.10 (a form XObject is a stream with `/Subtype /Form`), section 14.3.2
 * (the document's metadata stream has `/Subtype /XML`).
 *
 * The second opinion is the repository's pdfjs-dist 6.3.289: every file below that the check must refuse is also opened
 * with it, and it decodes the hidden stream (the form's text, the metadata title, the content's text come back), so the
 * file is a real one to the reader and not only to this check.
 *
 * Every title is a top-level `it(...)` call (see index.test.ts for why). The cap is 1 MiB for one stream and the data is
 * 2 MiB written as Flate by the platform's zlib (never the code under test), as picture-streams.test.ts does.
 */
const MIB = 1024 * 1024;
const LIMITS = { perStream: 1 * MIB };
const FONT: RawObject = { number: 6, body: Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>') };

/** A line of page content that shows `word`, followed by 2 MiB of spaces, as Flate. */
function flateShowing(word: string): Buffer {
  const text = Buffer.from(`BT /F1 12 Tf 10 10 Td (${word}) Tj ET\n`, 'latin1');
  return deflateSync(Buffer.concat([text, Buffer.alloc(2 * MIB, 0x20)]));
}

async function refusal(promise: Promise<unknown>): Promise<PdfToolError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(PdfToolError);
    return err as PdfToolError;
  }
  throw new Error('The check accepted a file it should have refused.');
}

/** The text PDF.js reads from page 1, the pieces joined with a bar. */
async function pdfJsText(bytes: Uint8Array): Promise<string> {
  const pdf = await openWithPdfJs(bytes);
  try {
    const page = await pdf.doc.getPage(1);
    const content = await page.getTextContent();
    return (content.items as { str?: string }[]).map((item) => item.str ?? '').join('|');
  } finally {
    await pdf.destroy();
  }
}

/** A page that draws form XObject 5, whose dictionary starts with `formEntries` and whose data shows "formtext". */
function formPdf(formEntries: string): Uint8Array {
  return buildRawPdf([
    { number: 1, body: Buffer.from('<< /Type /Catalog /Pages 2 0 R >>') },
    { number: 2, body: Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>') },
    {
      number: 3,
      body: Buffer.from(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Fm1 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 4 0 R >>',
      ),
    },
    { number: 4, body: streamObject('', Buffer.from('q /Fm1 Do Q')) },
    {
      number: 5,
      body: streamObject(
        `${formEntries} /BBox [0 0 100 100] /Resources << /Font << /F1 6 0 R >> >> /Filter /FlateDecode`,
        flateShowing('formtext'),
      ),
    },
    FONT,
    { number: 9, body: Buffer.from('/Form') },
  ]);
}

/** A file whose catalog names metadata stream 7, whose dictionary is `entries` and whose title is "metatitle". */
function metadataPdf(entries: string): Uint8Array {
  const xmp =
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">metatitle</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>\n';
  const data = deflateSync(Buffer.concat([Buffer.from(xmp, 'latin1'), Buffer.alloc(2 * MIB, 0x20)]));
  return buildRawPdf([
    { number: 1, body: Buffer.from('<< /Type /Catalog /Pages 2 0 R /Metadata 7 0 R >>') },
    { number: 2, body: Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>') },
    { number: 3, body: Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>') },
    { number: 7, body: streamObject(`${entries} /Filter /FlateDecode`, data) },
  ]);
}

/** Refused under the small cap; under a big one, counted as an ordinary stream and not as a picture. */
async function expectCountedAsStream(name: string, bytes: Uint8Array): Promise<void> {
  const error = await refusal(checkExpansion(bytes, { limits: LIMITS }));
  expect(error.kind, name).toBe('size');
  expect(error.message, name).toBe(EXPANSION_MESSAGE);
  const report = await checkExpansion(bytes, { limits: { perStream: 4 * MIB } });
  expect(report.images, name).toBe(0);
  expect(report.picturesCounted, name).toBe(0);
  expect(report.decodedBytes, name).toBeGreaterThan(2 * MIB);
}

it('a form or metadata stream is counted whatever picture label its dictionary text holds outside its own Subtype entries', async () => {
  const forms: [string, string][] = [
    ['a label inside a string', '/Type /XObject /Subtype /Form /Note (/Subtype /Image)'],
    ['two Subtype keys, the picture first', '/Type /XObject /Subtype /Image /Subtype /Form'],
    ['a label inside a nested dictionary', '/Type /XObject /Subtype /Form /Probe << /Subtype /Image >>'],
    ['a label inside an array', '/Type /XObject /Subtype /Form /Probe [/Subtype /Image]'],
    ['a second Subtype key written with a name escape', '/Type /XObject /Subtype /Image /Sub#74ype /Form'],
    ['a second Subtype key whose value is a reference', '/Type /XObject /Subtype /Image /Subtype 9 0 R'],
    [
      'a comment that hides a second Subtype key from a plain search',
      '/Type /XObject /Subtype /Image % (\n /Subtype /Form',
    ],
    [
      'a string that holds a dictionary start, a label and an escaped parenthesis',
      '/Type /XObject /Subtype /Form /Note (<< /Subtype /Image \\( )',
    ],
    [
      'a string that holds a dictionary start, a label and a percent sign',
      '/Type /XObject /Subtype /Form /Note (<< /Subtype /Image % )\n',
    ],
  ];
  for (const [name, entries] of forms) {
    const bytes = formPdf(entries);
    // The reader draws the form, so it decodes the stream.
    expect(await pdfJsText(bytes), name).toBe('formtext');
    await expectCountedAsStream(name, bytes);
  }

  const metadata: [string, string][] = [
    ['metadata with a label inside a string', '/Type /Metadata /Subtype /XML /Note (/Subtype /Image)'],
    ['metadata with two Subtype keys, the picture first', '/Type /Metadata /Subtype /Image /Subtype /XML'],
  ];
  for (const [name, entries] of metadata) {
    const bytes = metadataPdf(entries);
    const pdf = await openWithPdfJs(bytes);
    try {
      const read = await pdf.doc.getMetadata();
      expect(read.metadata?.get('dc:title'), name).toBe('metatitle');
    } finally {
      await pdf.destroy();
    }
    await expectCountedAsStream(name, bytes);
  }

  // Two Subtype keys in the other order: the reader takes the last one and draws a picture, and the check counts the
  // stream all the same, because a picture is only a stream whose every Subtype entry says Image.
  await expectCountedAsStream(
    'two Subtype keys, the picture last',
    formPdf('/Type /XObject /Subtype /Form /Subtype /Image'),
  );
});

it('a picture label written with name escapes, without spaces or beside nested entries is still read as a picture', async () => {
  const flate = deflateSync(Buffer.alloc(2 * MIB));
  const dictionaries: [string, string][] = [
    [
      'no spaces',
      '/Type/XObject/Subtype/Image/Width 1/Height 1/BitsPerComponent 8/ColorSpace/DeviceGray/Filter/FlateDecode',
    ],
    [
      'name escapes in the key and the value',
      `${PICTURE_DICTIONARY.replace('/Subtype /Image', '/Sub#74ype /Im#61ge')} /Filter /FlateDecode`,
    ],
    ['the same label twice', `${PICTURE_DICTIONARY} /Subtype /Image /Filter /FlateDecode`],
    [
      'a nested dictionary with its own Subtype',
      `${PICTURE_DICTIONARY} /DecodeParms << /Predictor 1 /Subtype /Form >> /Filter /FlateDecode`,
    ],
    [
      'an indexed colour space with a string table, escapes and a hexadecimal string',
      '/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace [/Indexed /DeviceRGB 1 (\\)\\(a(b)c)] /Mask <00ff> /Filter /FlateDecode',
    ],
    [
      'a line break before the label',
      '/Type /XObject\r\n/Subtype\n/Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode',
    ],
  ];
  for (const [name, dictionary] of dictionaries) {
    // Drawn as an image and used by nothing a reader decodes: left out.
    const bytes = pageWith('/Resources << /XObject << /Im0 4 0 R >> >>', [
      { number: 4, body: streamObject(dictionary, flate) },
    ]);
    const report = await checkExpansion(bytes, { limits: LIMITS });
    expect(report.images, name).toBe(1);
    expect(report.decoded, name).toBe(0);
    expect(report.decodedBytes, name).toBe(0);
  }
  // A picture whose dictionary holds a comment cannot be read the way a reader reads it, so it is counted.
  const commented = pageWith('/Resources << /XObject << /Im0 4 0 R >> >>', [
    { number: 4, body: streamObject(`${PICTURE_DICTIONARY} % a note\n/Filter /FlateDecode`, flate) },
  ]);
  expect((await refusal(checkExpansion(commented, { limits: LIMITS }))).message).toBe(EXPANSION_MESSAGE);
  // And the same picture used as page content is counted as a picture.
  const used = pageWith('/Contents 4 0 R', [
    { number: 4, body: pictureStream('/DecodeParms << /Subtype /Form >>', flate) },
  ]);
  const error = await refusal(checkExpansion(used, { limits: LIMITS }));
  expect(error.message).toBe(EXPANSION_MESSAGE);
  expect((await checkExpansion(used, { limits: { perStream: 4 * MIB } })).picturesCounted).toBe(1);
});

/**
 * A one page file whose `/Contents` is object 4, a picture-labelled stream that shows "headertext", written with the
 * object header `header` (`4 0 obj` and whatever stands between it and the dictionary). The cross-reference table points
 * at the header, so a reader finds the object however its header is written.
 */
function contentWithHeader(header: string): Uint8Array {
  const objects: [number, Buffer][] = [
    [1, Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')],
    [2, Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')],
    [
      3,
      Buffer.from(
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 6 0 R >> >> /Contents 4 0 R >>\nendobj\n',
      ),
    ],
    [
      4,
      Buffer.concat([
        Buffer.from(header, 'latin1'),
        pictureStream('', flateShowing('headertext')),
        Buffer.from('\nendobj\n'),
      ]),
    ],
    [6, Buffer.from('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')],
  ];
  let out = Buffer.from('%PDF-1.5\n');
  const offsets = new Map<number, number>();
  for (const [number, body] of objects) {
    offsets.set(number, out.length);
    out = Buffer.concat([out, body]);
  }
  let xref = 'xref\n0 7\n0000000000 65535 f \n';
  for (let n = 1; n < 7; n++) {
    const at = offsets.get(n);
    xref += at === undefined ? '0000000000 00000 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`;
  }
  const xrefAt = out.length;
  out = Buffer.concat([out, Buffer.from(`${xref}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`)]);
  return new Uint8Array(out);
}

it('a picture-labelled stream whose object number cannot be read is counted, used or not', async () => {
  const headers: [string, string][] = [
    ['a comment between the header and the dictionary', '4 0 obj\n% a note\n'],
    ['a comment between the two numbers', '4 %x\n0 obj\n'],
    ['two thousand spaces before the dictionary', `4 0 obj${' '.repeat(2000)}`],
  ];
  for (const [name, header] of headers) {
    const bytes = contentWithHeader(header);
    // The reader finds the object through the cross-reference table and decodes it as the page content.
    expect(await pdfJsText(bytes), name).toBe('headertext');
    const error = await refusal(checkExpansion(bytes, { limits: LIMITS }));
    expect(error.kind, name).toBe('size');
    expect(error.message, name).toBe(EXPANSION_MESSAGE);
    const report = await checkExpansion(bytes, { limits: { perStream: 4 * MIB } });
    expect(report.picturesCounted, name).toBe(1);
    expect(report.images, name).toBe(0);
  }
  // The same file with an ordinary header: the picture is matched to its use and counted, as before.
  const plain = contentWithHeader('4 0 obj\n');
  expect(await pdfJsText(plain)).toBe('headertext');
  expect((await refusal(checkExpansion(plain, { limits: LIMITS }))).message).toBe(EXPANSION_MESSAGE);
});

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
}

/** The median of five timings of the check, after one run to warm the code up; a refusal is an answer too. */
async function medianMilliseconds(bytes: Uint8Array): Promise<number> {
  await checkExpansion(bytes).catch(() => undefined);
  const times: number[] = [];
  for (let run = 0; run < 5; run++) {
    const started = performance.now();
    await checkExpansion(bytes).catch(() => undefined);
    times.push(performance.now() - started);
  }
  return median(times);
}

interface Scaling {
  double: number;
  quadruple: number;
  times: string;
}

async function scaling(make: (n: number) => Uint8Array, n: number): Promise<Scaling> {
  const small = await medianMilliseconds(make(n));
  const double = await medianMilliseconds(make(2 * n));
  const quadruple = await medianMilliseconds(make(4 * n));
  const base = Math.max(small, 1);
  return { double: double / base, quadruple: quadruple / base, times: `${small} ms, ${double} ms, ${quadruple} ms` };
}

/**
 * Linear: twice the input takes less than six times as long and four times the input less than twelve times (the
 * doubling rule alone does not catch quadratic growth). A machine under load can read one ratio over the limit once:
 * two more measurements follow and the median of the three is judged against the same limits.
 */
async function expectLinear(name: string, make: (n: number) => Uint8Array, n: number): Promise<void> {
  let result = await scaling(make, n);
  if (!(result.double < 6 && result.quadruple < 12)) {
    const all = [result, await scaling(make, n), await scaling(make, n)];
    result = {
      double: median(all.map((one) => one.double)),
      quadruple: median(all.map((one) => one.quadruple)),
      times: all.map((one) => one.times).join(' / '),
    };
  }
  expect(result.double, `${name}: ${result.times}`).toBeLessThan(6);
  expect(result.quadruple, `${name}: ${result.times}`).toBeLessThan(12);
}

/** `count` stream objects, each with a dictionary of about 16 KiB that repeats `unit`, and no cross-reference table. */
function manyDictionaries(unit: string, count: number): Uint8Array {
  const dictionary = `<< /Type /XObject /Subtype /Image ${unit.repeat(Math.max(1, Math.floor(16_384 / unit.length)))} /Length 1 >>`;
  const parts: Buffer[] = [Buffer.from('%PDF-1.5\n')];
  const object = Buffer.from(`${dictionary}\nstream\nx\nendstream\nendobj\n`, 'latin1');
  for (let i = 0; i < count; i++) parts.push(Buffer.from(`${i + 1} 0 obj\n`), object);
  return new Uint8Array(Buffer.concat(parts));
}

it('stream dictionaries full of strings, comments, brackets and names are read in linear time', async () => {
  const units: [string, string][] = [
    ['short strings', '(x) '],
    ['deeply nested strings', '(((((((((('],
    ['escaped parentheses in a string', '(\\(\\)\\\\) '],
    ['comments', '% c\n'],
    ['hexadecimal strings', '<0a1B> '],
    ['nested dictionaries', '<< /A << >> >> '],
    ['open arrays', '['],
    ['stray closing brackets', '] ) > '],
    ['stray dictionary ends', '>> '],
    ['Subtype keys with no value', '/Subtype '],
    ['name escapes', '/#53ub#74ype /Im#61ge '],
    ['backslashes outside strings', '\\\\ '],
    ['numbers and keywords', '12 0 R true null '],
  ];
  for (const [name, unit] of units) await expectLinear(name, (n) => manyDictionaries(unit, n), 64);
}, 300_000);
