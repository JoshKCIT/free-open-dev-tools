// Tests are built around RFC 2397 (https://www.rfc-editor.org/rfc/rfc2397),
// "The 'data' URL scheme", fetched and read in full while this package was
// written. Section 4 prints four worked examples; three are well-formed and
// asserted directly below, and the fourth (the charset example) contains an
// invalid percent escape and is asserted as a rejection instead, per this
// plan's own instructions.
import { describe, it, expect } from 'vitest';
import { buildDataUri, parseDataUri, DataUriError, MAX_DATA_URI_BYTES } from '../src/index';

// --- The four `it(...)` calls below carry exact, verbatim titles that this
// plan's `<verify>` block reads out of the JSON test report by full name.
// They are deliberately top-level, not nested in a `describe`. (Three more
// required titles are grouped with related coverage further down, also
// kept top-level for the same reason.)

it('the RFC 2397 no-media-type example decodes to its published bytes', () => {
  // RFC 2397 section 4: "the URL data:,A%20brief%20note encodes the
  // text/plain string 'A brief note'".
  const parsed = parseDataUri('data:,A%20brief%20note');
  expect(parsed.mediaType).toBe('text/plain');
  expect(parsed.params).toEqual([['charset', 'US-ASCII']]);
  expect(new TextDecoder().decode(parsed.bytes)).toBe('A brief note');
});

it('data:, with an empty payload decodes to zero bytes rather than being rejected', () => {
  const parsed = parseDataUri('data:,');
  expect(parsed.bytes.length).toBe(0);
  expect(parsed.base64).toBe(false);
});

it('data:;base64, with an empty payload decodes to zero bytes', () => {
  const parsed = parseDataUri('data:;base64,');
  expect(parsed.bytes.length).toBe(0);
  expect(parsed.base64).toBe(true);
});

it('a payload larger than the documented ceiling is rejected before it is expanded', () => {
  // A percent-encoded body one character per byte, well past the ceiling,
  // built without ever allocating that many actual bytes.
  const hugeBody = 'a'.repeat(MAX_DATA_URI_BYTES + 1);
  expect(() => parseDataUri(`data:text/plain,${hugeBody}`)).toThrow(DataUriError);

  // The same ceiling on the encoding side, checked against the input byte
  // array before any base64/percent expansion happens.
  const hugeBytes = new Uint8Array(MAX_DATA_URI_BYTES + 1);
  expect(() => buildDataUri(hugeBytes)).toThrow(DataUriError);
});

describe('RFC 2397 worked examples (section 4)', () => {
  it('the well-formed base64 GIF example decodes to the same bytes Node’s own base64 decoder produces', () => {
    // RFC 2397 section 4's <IMG> example. The RFC's own printed layout
    // wraps this across several lines purely for page width; the actual
    // URL has no whitespace, so the line breaks are stripped here.
    const base64Body = `R0lGODdhMAAwAPAAAAAAAP///ywAAAAAMAAw
       AAAC8IyPqcvt3wCcDkiLc7C0qwyGHhSWpjQu5yqmCYsapyuvUUlvONmOZtfzgFz
       ByTB10QgxOR0TqBQejhRNzOfkVJ+5YiUqrXF5Y5lKh/DeuNcP5yLWGsEbtLiOSp
       a/TPg7JpJHxyendzWTBfX0cxOnKPjgBzi4diinWGdkF8kjdfnycQZXZeYGejmJl
       ZeGl9i2icVqaNVailT6F5iJ90m6mvuTS4OK05M0vDk0Q4XUtwvKOzrcd3iq9uis
       F81M1OIcR7lEewwcLp7tuNNkM3uNna3F2JQFo97Vriy/Xl4/f1cf5VWzXyym7PH
       hhx4dbgYKAAA7`.replace(/\s+/g, '');

    const parsed = parseDataUri(`data:image/gif;base64,${base64Body}`);
    expect(parsed.mediaType).toBe('image/gif');
    expect(parsed.base64).toBe(true);
    // GIF's own six-byte signature, ASCII "GIF87a" -- confirms this is a
    // genuine, well-formed decode rather than an accidentally-empty one.
    expect(new TextDecoder().decode(parsed.bytes.slice(0, 6))).toBe('GIF87a');
    // Node's own base64 decoder as an independent second opinion on the
    // exact bytes, rather than transcribing hundreds of bytes by hand.
    expect(Buffer.from(parsed.bytes)).toEqual(Buffer.from(base64Body, 'base64'));
  });

  it('the vnd-xxx-query example keeps its literal comma and slash unescaped in the data segment', () => {
    // RFC 2397 section 4: "data:application/vnd-xxx-query,select_vcount,fcol_from_fieldtable/local".
    // Only the FIRST comma (right after the media type) separates the
    // header from the data -- everything after it, including its own
    // literal comma and slash, is the data itself.
    const value = 'data:application/vnd-xxx-query,select_vcount,fcol_from_fieldtable/local';
    const parsed = parseDataUri(value);
    expect(parsed.mediaType).toBe('application/vnd-xxx-query');
    expect(parsed.base64).toBe(false);
    expect(new TextDecoder().decode(parsed.bytes)).toBe('select_vcount,fcol_from_fieldtable/local');
  });
});

// The RFC 2397 charset example: a documented defect, not a success case.
// Both titles below are exact, verbatim strings this plan's `<verify>`
// block reads out of the JSON test report by full name, so both stay
// top-level rather than nested in a `describe`.

it('the RFC 2397 charset example containing %fg is REJECTED naming the position of the bad escape', () => {
  // RFC 2397 section 4: "data:text/plain;charset=iso-8859-7,%be%fg%be
  // can be used for a short sequence of greek characters." The second
  // escape, %fg, is not a valid percent escape under the grammar the
  // same document defines: "g" is not a hexadecimal digit. A
  // grammar-correct parser cannot decode this, so it is asserted here as
  // a rejection -- the correct behaviour -- rather than "fixed" by
  // loosening the parser to accept it.
  const value = 'data:text/plain;charset=iso-8859-7,%be%fg%be';
  let caught: unknown;
  try {
    parseDataUri(value);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(DataUriError);
  const err = caught as DataUriError;
  // Position of the bad digit itself ("g"), not of the "%" or the "f".
  expect(err.position).toBe(value.indexOf('g'));
  expect(err.message).toMatch(/g/);
});

it('a valid percent-encoded charset payload decodes to its bytes', () => {
  // A hand-written replacement for the RFC's malformed example, same
  // shape (text/plain;charset=iso-8859-7) with a WELL-FORMED escape.
  // %b5 is a well-formed percent escape for byte 0xB5; under
  // ISO-8859-7 per the WHATWG Encoding Standard's own index table
  // (https://encoding.spec.whatwg.org/index-iso-8859-7.txt, offset 53 =
  // byte 0x80+53 = 0xB5) that byte is U+0385 GREEK DIALYTIKA TONOS --
  // though this parser never interprets charset, it only returns raw
  // bytes, which is exactly what this test checks. The literal "A" and
  // "Z" surrounding it are their own ASCII byte values. Expected bytes,
  // computed by hand: 0x41 ('A'), 0xB5, 0x5A ('Z').
  const value = 'data:text/plain;charset=iso-8859-7,A%b5Z';
  const parsed = parseDataUri(value);
  expect(parsed.mediaType).toBe('text/plain');
  expect(parsed.params).toEqual([['charset', 'iso-8859-7']]);
  expect(Array.from(parsed.bytes)).toEqual([0x41, 0xb5, 0x5a]);
});

it('the shorthand form (media type omitted, charset alone supplied) fills in text/plain', () => {
  // RFC 2397 section 2: "As a shorthand, 'text/plain' can be omitted but
  // the charset parameter supplied."
  const parsed = parseDataUri('data:;charset=utf-8,hi');
  expect(parsed.mediaType).toBe('text/plain');
  expect(parsed.params).toEqual([['charset', 'utf-8']]);
});

it('binary and text payloads round trip in both base64 and percent-encoded form', () => {
  const text = new TextEncoder().encode('Round trips through both forms, including a comma, and 100% of it.');
  const binary = new Uint8Array(256);
  for (let i = 0; i < 256; i++) binary[i] = i;

  for (const payload of [text, binary]) {
    for (const base64 of [true, false]) {
      const { dataUri } = buildDataUri(payload, { mediaType: 'application/octet-stream', base64 });
      const parsed = parseDataUri(dataUri);
      expect(Array.from(parsed.bytes)).toEqual(Array.from(payload));
      expect(parsed.base64).toBe(base64);
    }
  }
});

describe('grammar rejections', () => {
  it('a value not beginning with the data: scheme is rejected, naming what was found', () => {
    let caught: unknown;
    try {
      parseDataUri('http://example.com/x');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DataUriError);
    expect((caught as DataUriError).message).toContain('http://example.com/x');
  });

  it('a value with no comma is rejected, saying the comma separates the header from the data', () => {
    let caught: unknown;
    try {
      parseDataUri('data:text/plain;base64');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DataUriError);
    expect((caught as DataUriError).message.toLowerCase()).toContain('comma');
    expect((caught as DataUriError).message.toLowerCase()).toContain('separates');
  });

  it('a base64 payload with an invalid character is rejected with its position', () => {
    const value = 'data:image/png;base64,####';
    let caught: unknown;
    try {
      parseDataUri(value);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DataUriError);
    const err = caught as DataUriError;
    expect(err.position).toBe(value.indexOf('#'));
  });
});

it('media type parameters are preserved in order and returned separately from the media type itself', () => {
  const parsed = parseDataUri('data:text/plain;charset=iso-8859-7;foo=bar,hi');
  expect(parsed.mediaType).toBe('text/plain');
  expect(parsed.params).toEqual([
    ['charset', 'iso-8859-7'],
    ['foo', 'bar'],
  ]);
});

describe('buildDataUri: media type resolution and its reported source', () => {
  it('uses an explicit override when one is given, reporting source "override"', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = buildDataUri(png, { mediaType: 'application/x-something-else' });
    expect(result.mediaType).toBe('application/x-something-else');
    expect(result.source).toBe('override');
  });

  it('uses the signature table when no override is given, reporting source "signature"', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = buildDataUri(png);
    expect(result.mediaType).toBe('image/png');
    expect(result.source).toBe('signature');
  });

  it('falls back to the browser-reported type when the signature table finds nothing, reporting which source won', () => {
    const junk = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const result = buildDataUri(junk, { browserReportedType: 'application/x-mystery' });
    expect(result.mediaType).toBe('application/x-mystery');
    expect(result.source).toBe('browser-reported');
  });

  it('reports "unknown" when neither the signature table nor the browser produced anything', () => {
    const junk = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const result = buildDataUri(junk);
    expect(result.mediaType).toBe('application/octet-stream');
    expect(result.source).toBe('unknown');
  });
});

it('the package imports nothing from outside its own folder and mentions no browser file or blob type', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  expect(src.includes('@fodt/')).toBe(false);
  for (const forbidden of ['File', 'Blob', 'FileReader', 'Worker']) {
    expect(new RegExp(`[^A-Za-z0-9_]${forbidden}[^A-Za-z0-9_]`).test(src), `found "${forbidden}"`).toBe(false);
  }
});
